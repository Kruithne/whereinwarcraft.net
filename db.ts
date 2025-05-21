import { db_init_mysql, caution } from 'spooder';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const db_pool = await db_init_mysql({
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_DATABASE,
	connectionLimit: 10
}, undefined, true);

type db_pool = typeof db_pool;
type db = db_pool | PoolConnection;
type PoolConnection = ReturnType<typeof db_pool.getConnection> extends Promise<infer T> ? T : never;

class DatabaseInterface {
	private db;

	constructor(db: db) {
		this.db = db;
	}

	/**
	 * Returns a SET string as an array cast to a specific enum type.
	 */
	cast_set<T extends string>(set: string | null): T[] {
		return set ? set.split(',') as T[] : [];
	}

	/**
	 * Executes an insert query and returns the LAST_INSERT ID.
	 * Provided object is used as a key/value mapping for the insert.
	 * 
	 * In the event of an error or the resulting query does not provide a LAST_INSERT_ID, -1 is returned.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 */
	async insert_object(table: string, obj: Record<string, any>): Promise<number> {
		try {
			const values = Object.values(obj);
			let sql = 'INSERT INTO `' + table + '` (';
			sql += Object.keys(obj).map(e => '`' + e + '`').join(', ');
			sql += ') VALUES(' + values.map(() => '?').join(', ') + ')';

			const [result] = await this.db.query<ResultSetHeader>(sql, values);
			return result.insertId ?? -1;
		} catch (error) {
			caution('sql: insert object failed', { error, obj });
			return -1;
		}
	}

	/**
	 * Executes a query and returns the LAST_INSERT_ID.
	 * 
	 * 
	 * In the event of an error or the resulting query does not provide a LAST_INSERT_ID, -1 is returned.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 * @param sql 
	 * @param values 
	 * @returns 
	 */
	async insert(sql: string, values: any = []): Promise<number> {
		try {
			const [result] = await this.db.query<ResultSetHeader>(sql, values);
			return result.insertId ?? -1;
		} catch (error) {
			caution('sql: insert failed', { error });
			return -1;
		}
	}

	/**
	 * Executes a query with no return result.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 * @param sql 
	 * @param values 
	 */
	async execute(sql: string, values: any = []): Promise<number> {
		try {
			const [result] = await this.db.query<ResultSetHeader>(sql, values);
			return result.affectedRows;
		} catch (error) {
			caution('sql: execute failed', { error });
			return -1;
		}
	}

	/**
	 * Returns the complete query result set as an array.
	 * 
	 * If no rows returned, returns an empty array.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 * @param sql 
	 * @param values 
	 * @returns 
	 */
	async get_all(sql: string, values: any = []): Promise<RowDataPacket[]> {
		try {
			const [rows] = await this.db.execute(sql, values);
			return rows as RowDataPacket[];
		} catch (error) {
			caution('sql: get_all failed', { error });
			return [];
		}
	}

	/**
	 * Returns the query result as a single column array.
	 * 
	 * If no rows are returned, returns an empty array.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 */
	async get_column_array(sql: string, column: string, values: any = []): Promise<RowDataPacket[]> {
		try {
			const [rows] = await this.db.execute(sql, values) as RowDataPacket[];
			return rows.map((e: any) => e[column]);
		} catch (error) {
			caution('sql: get_column_array failed', { error });
			return [];
		}
	}

	/**
	 * Calls a stored procedure and returns the result set as an array.
	 * 
	 * If no rows returned, returns an empty array.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 * @param sql
	 * @param values
	 */
	async call(sql: string, values: any = []): Promise<RowDataPacket[]> {
		try {
			const result = await this.db.execute<RowDataPacket[][]>('CALL ' + sql, values);
			return result[0][0];
		} catch (error) {
			caution('sql: call failed', { error });
			return [];
		}
	}
	
	/**
	 * Returns the first row from a query result set.
	 * 
	 * If no rows returned, returns null.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 * @param sql 
	 * @param values 
	 * @returns 
	 */
	async get_single(sql: string, values: any = []): Promise<RowDataPacket|null> {
		const rows = await this.get_all(sql, values);
		return rows[0] ?? null;
	}

	/**
	 * Returns an async iterator that yields pages of database rows.
	 * Each page contains at most `page_size` rows (default 30).
	 * The database is only queried for `page_size` rows at a time to reduce memory usage.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 * @param sql The SQL query to execute
	 * @param values Parameters for the query
	 * @param page_size Number of rows per page (default: 1000)
	 * @returns Async iterator of pages of rows
	 */
	async *get_paged(sql: string, values: any = [], page_size: number = 1000): AsyncGenerator<RowDataPacket[]> {
		let current_offset = 0;
		
		while (true) {
			try {
				const paged_sql = `${sql} LIMIT ${page_size} OFFSET ${current_offset}`;
				
				const [rows] = await this.db.execute(paged_sql, values);
				const page_rows = rows as RowDataPacket[];
				
				if (page_rows.length === 0)
					break;
				
				yield page_rows;
				
				current_offset += page_size;
				
				if (page_rows.length < page_size)
					break;
			} catch (error) {
				caution('sql: get_paged failed', { error, offset: current_offset });
				return;
			}
		}
	}

	/**
	 * Returns the value of `count` from a query.
	 * 
	 * Returns 0 in event of an error.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 * @param sql 
	 * @param values 
	 * @returns 
	 */
	async count(sql: string, values: any = []): Promise<number> {
		const row = await this.get_single(sql, values);
		return row?.count ?? 0;
	}

	/**
	 * Returns the total count of rows from a table.
	 * 
	 * Returns 0 in the event of an error.
	 * 
	 * Does now throw. Errors are internally raised as a canary caution.
	 */
	async count_table(table_name: string): Promise<number> {
		return await this.count('SELECT COUNT(*) AS `count` FROM `' + table_name + '`');
	}

	/**
	 * Returns true if the query returns any results.
	 * 
	 * Best used in conjuction with a SELECT 1 FROM ... LIMIT 1 query to check existence.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 * @param sql 
	 * @param values 
	 * @returns 
	 */
	async exists(sql: string, values: any = []): Promise<boolean> {
		const row = await this.get_single(sql, values);
		return row !== null;
	}

	/**
	 * Returns true if the given ID exists in the given table.
	 * 
	 * Shorthand for db.exists('SELECT 1 FROM table WHERE `id` = ? LIMIT 1')
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 */
	async exists_by_id(table_name: string, id: string|number, column_name = 'id'): Promise<boolean> {
		const row = await this.get_single('SELECT 1 FROM ' + table_name + ' WHERE `' + column_name + '` = ? LIMIT 1', [id]);
		return row !== null;
	}

	/**
	 * Returns true if a row matches the given fields.
	 * 
	 * Shorthand for db.exists('SELECT 1 FROM table WHERE `x` = ? AND `y` = ? LIMIT 1')
	 * 
	 * If filtering by one column, use db.exists_by_id() as a faster alternative.
	 * 
	 * Does not throw. Errors are internally raised as a canary caution.
	 */
	async exists_by_fields(table_name: string, fields: Record<string, string|number>): Promise<boolean> {
		const clauses = [];
		const params = [];

		for (const [key, value] of Object.entries(fields)) {
			clauses.push('`' + key + '` = ?');
			params.push(value);
		}

		const row = await this.get_single('SELECT 1 FROM ' + table_name + ' WHERE ' + clauses.join(' AND ') + ' LIMIT 1', params);
		return row !== null;
	}

	/**
	 * Creates a transactional scope.
	 * 
	 * `transaction` is a DatabaseInterface scoped to a connection within the pool which has a transaction started
	 * 
	 * When the scope exits, COMMIT will be called.
	 * 
	 * If an error is thrown within the scope, ROLLBACK will be called and the error will be raised as a canary caution.
	 * 
	 * It's important to note that database interface functions do not throw, therefore do not break a transaction.
	 * If the result of a query should rollback the transaction, throw an error.
	 * @param scope 
	 * @returns 
	 */
	async transaction(scope: (transaction: DatabaseInterface) => void | Promise<void>): Promise<boolean> {
		const connection = await (this.db as db_pool).getConnection();
		const instance = new DatabaseInterface(connection);

		await connection.beginTransaction();

		try {
			await scope(instance);
			await connection.commit();
			return true;
		} catch (error) {
			caution('sql: transaction failed', { error });
			await connection.rollback();
			return false;
		} finally {
			connection.release();
		}
	}
}

export default new DatabaseInterface(db_pool);