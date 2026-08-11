import mysql from 'mysql2/promise';
import { log_create_logger } from 'spooder';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2';

const SCHEMA_TABLE = 'db_schema';
const REVISION_DIR = './db/revisions';

const log = log_create_logger('db_schema', '#42f5a7');

type Revision = {
	revision_number: number;
	file_path: string;
	filename: string;
};

type SchemaResult = {
	success: boolean;
	error?: string;
	failed_revision?: string;
};

async function get_schema_revision(conn: mysql.Connection): Promise<number|null> {
	try {
		const [rows] = await conn.execute<RowDataPacket[]>(`SELECT MAX(revision_number) AS latest_revision FROM \`${SCHEMA_TABLE}\``);
		return rows[0]?.latest_revision ?? 0;
	} catch {
		return null;
	}
}

async function collect_revisions(current_revision: number): Promise<Revision[]> {
	const revisions: Revision[] = [];
	const files = await fs.readdir(REVISION_DIR, { encoding: 'utf8' });

	for (const file of files) {
		if (!file.toLowerCase().endsWith('.sql'))
			continue;

		const match = file.match(/^(\d+)/);
		const revision_number = match ? Number(match[1]) : null;

		if (revision_number === null || revision_number < 1) {
			log`skipping sql file ${file}, invalid revision number`;
			continue;
		}

		if (revision_number > current_revision) {
			revisions.push({
				revision_number,
				file_path: path.join(REVISION_DIR, file),
				filename: file
			});
		}
	}

	revisions.sort((a, b) => a.revision_number - b.revision_number);

	return revisions;
}

async function apply_revisions(conn: mysql.Connection): Promise<SchemaResult> {
	let current_revision = await get_schema_revision(conn);

	if (current_revision === null) {
		log`initiating schema table ${SCHEMA_TABLE}`;
		await conn.execute(
			`CREATE TABLE \`${SCHEMA_TABLE}\` (
				revision_number INTEGER PRIMARY KEY,
				filename VARCHAR(255) NOT NULL,
				applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
			)`
		);
	}

	current_revision ??= 0;

	const revisions = await collect_revisions(current_revision);

	if (revisions.length === 0) {
		log`no schema revisions to apply (current: ${current_revision})`;
		return { success: true };
	}

	for (const rev of revisions) {
		log`applying revision ${rev.revision_number} from ${rev.filename}`;

		try {
			const sql = await fs.readFile(rev.file_path, 'utf8');

			await conn.beginTransaction();
			await conn.query(sql);
			await conn.execute(
				`INSERT INTO \`${SCHEMA_TABLE}\` (revision_number, filename) VALUES (?, ?)`,
				[rev.revision_number, rev.filename]
			);
			await conn.commit();
		} catch (error) {
			try {
				await conn.rollback();
			} catch {}

			log`failed to apply revision from ${rev.filename}: ${error}`;
			log`${'warning'}: DDL statements in ${rev.filename} are ${'not'} rolled back automatically`;
			log`verify the database state ${'before'} running an amended revision`;

			return {
				success: false,
				error: String(error),
				failed_revision: rev.filename
			};
		}
	}

	const new_revision = await get_schema_revision(conn);
	log`applied ${revisions.length} schema revisions (${current_revision} >> ${new_revision})`;

	return { success: true };
}

export async function db_schema(): Promise<SchemaResult> {
	let conn: mysql.Connection;

	try {
		conn = await mysql.createConnection({
			host: process.env.DB_HOST,
			user: process.env.DB_USER,
			password: process.env.DB_PASSWORD,
			database: process.env.DB_DATABASE,
			multipleStatements: true
		});
	} catch (error) {
		return { success: false, error: String(error) };
	}

	try {
		return await apply_revisions(conn);
	} finally {
		await conn.end();
	}
}
