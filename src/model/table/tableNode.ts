import * as path from "path";
import * as vscode from "vscode";
import mysqldump from 'mysqldump';
import { QueryUnit } from "../../database/QueryUnit";
import { ColumnNode } from "./columnNode";
import { InfoNode } from "../InfoNode";
import { Node } from "../interface/node";
import { DatabaseCache } from "../../database/DatabaseCache";
import { ModelType, Constants } from "../../common/Constants";
import { ConnectionInfo } from "../interface/connection";
import { Console } from "../../common/OutputChannel";
import { ConnectionManager } from "../../database/ConnectionManager";
import { MySQLTreeDataProvider } from "../../provider/MysqlTreeDataProvider";
import { Util } from "../../common/util";
import { CopyAble } from "../interface/copyAble";
import format = require('date-format');


export class TableNode implements Node, ConnectionInfo, CopyAble {


    public identify: string;
    public type: string = ModelType.TABLE;

    constructor(readonly host: string, readonly user: string, readonly password: string,
        readonly port: string, readonly database: string, readonly table: string,
        readonly certPath: string) {
        this.identify = `${this.host}_${this.port}_${this.user}_${this.database}_${this.table}`;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            label: this.table,
            collapsibleState: DatabaseCache.getElementState(this),
            contextValue: ModelType.TABLE,
            iconPath: path.join(Constants.RES_PATH, "table.svg"),
            command: {
                command: "mysql.template.sql",
                title: "Run Select Statement",
                arguments: [this, true],
            },
        };

    }

    public async getChildren(isRresh: boolean = false): Promise<Node[]> {
        let columnNodes = DatabaseCache.getColumnListOfTable(this.identify);
        if (columnNodes && !isRresh) {
            return columnNodes;
        }
        return QueryUnit.queryPromise<any[]>(await ConnectionManager.getConnection(this), `SELECT COLUMN_NAME name,COLUMN_TYPE type,COLUMN_COMMENT comment,COLUMN_KEY \`key\`,IS_NULLABLE nullable,CHARACTER_MAXIMUM_LENGTH maxLength FROM information_schema.columns WHERE table_schema = '${this.database}' AND table_name = '${this.table}';`)
            .then((columns) => {
                columnNodes = columns.map<ColumnNode>((column) => {
                    return new ColumnNode(this.host, this.user, this.password, this.port, this.database, this.table, this.certPath, column);
                });
                DatabaseCache.setColumnListOfTable(this.identify, columnNodes);

                return columnNodes;
            })
            .catch((err) => {
                return [new InfoNode(err)];
            });
    }

    public addColumnTemplate() {
        ConnectionManager.getConnection(this, true);
        QueryUnit.createSQLTextDocument(`ALTER TABLE
    ${Util.wrap(this.database)}.${Util.wrap(this.table)} 
ADD 
    COLUMN [column] [type] NOT NULL comment '';`);
    }


    public async showSource() {
        QueryUnit.queryPromise<any[]>(await ConnectionManager.getConnection(this, true), `SHOW CREATE TABLE \`${this.database}\`.\`${this.table}\``)
            .then((procedDtail) => {
                QueryUnit.showSQLTextDocument(procedDtail[0]['Create Table']);
            });
    }

    public changeTableName() {

        vscode.window.showInputBox({ value: this.table, placeHolder: 'newTableName', prompt: `You will changed ${this.database}.${this.table} to new table name!` }).then(async (newTableName) => {
            if (!newTableName) { return; }
            const sql = `RENAME TABLE \`${this.database}\`.\`${this.table}\` to \`${this.database}\`.\`${newTableName}\``;
            QueryUnit.queryPromise(await ConnectionManager.getConnection(this), sql).then((rows) => {
                DatabaseCache.clearTableCache(`${this.host}_${this.port}_${this.user}_${this.database}`);
                MySQLTreeDataProvider.refresh();
            });

        });

    }

    public dropTable() {

        vscode.window.showInputBox({ prompt: `Are you want to drop table ${this.table} ?     `, placeHolder: 'Input y to confirm.' }).then(async (inputContent) => {
            if (!inputContent) { return; }
            if (inputContent.toLocaleLowerCase() == 'y') {
                QueryUnit.queryPromise(await ConnectionManager.getConnection(this), `DROP TABLE \`${this.database}\`.\`${this.table}\``).then(() => {
                    DatabaseCache.clearTableCache(`${this.host}_${this.port}_${this.user}_${this.database}`);
                    MySQLTreeDataProvider.refresh();
                    vscode.window.showInformationMessage(`Drop table ${this.table} success!`);
                });
            } else {
                vscode.window.showInformationMessage(`Cancel drop table ${this.table}!`);
            }
        });

    }


    public truncateTable() {

        vscode.window.showInputBox({ prompt: `Are you want to clear table ${this.table} all data ?          `, placeHolder: 'Input y to confirm.' }).then(async (inputContent) => {
            if (!inputContent) { return; }
            if (inputContent.toLocaleLowerCase() == 'y') {
                QueryUnit.queryPromise(await ConnectionManager.getConnection(this), `truncate table \`${this.database}\`.\`${this.table}\``).then(() => {
                    vscode.window.showInformationMessage(`Clear table ${this.table} all data success!`);
                });
            }
        });


    }

    public indexTemplate() {
        ConnectionManager.getConnection(this, true);
        QueryUnit.showSQLTextDocument(`-- ALTER TABLE \`${this.database}\`.\`${this.table}\` DROP INDEX [indexName];
-- ALTER TABLE \`${this.database}\`.\`${this.table}\` ADD [UNIQUE|KEY|PRIMARY KEY] INDEX ([column]);`);
        setTimeout(() => {
            QueryUnit.runQuery(`SELECT COLUMN_NAME name,table_schema,index_name,non_unique FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema='${this.database}' and table_name='${this.table}';`, this);
        }, 10);

    }


    public async selectSqlTemplate(run: boolean) {
        const sql = `SELECT * FROM ${Util.wrap(this.database)}.${Util.wrap(this.table)} LIMIT ${Constants.DEFAULT_SIZE};`;

        if (run) {
            ConnectionManager.getConnection(this, true);
            QueryUnit.runQuery(sql, this);
        } else {
            QueryUnit.createSQLTextDocument(sql);
        }

    }

    public insertSqlTemplate() {
        this
            .getChildren()
            .then((children: Node[]) => {
                const childrenNames = children.map((child: any) => "\n    " + child.column.name);
                let sql = `insert into \n  ${Util.wrap(this.database)}.${Util.wrap(this.table)} `;
                sql += `(${childrenNames.toString().replace(/,/g, ", ")}\n  )\n`;
                sql += "values\n  ";
                sql += `(${childrenNames.toString().replace(/,/g, ", ")}\n  );`;
                QueryUnit.createSQLTextDocument(sql);
            });
    }

    public deleteSqlTemplate(): any {
        this
            .getChildren()
            .then((children: Node[]) => {
                const keysNames = children.filter((child: any) => child.column.key).map((child: any) => child.column.name);

                const where = keysNames.map((name: string) => `${name} = ${name}`);

                let sql = `delete from \n  ${Util.wrap(this.database)}.${Util.wrap(this.table)} \n`;
                sql += `where \n  ${where.toString().replace(/,/g, "\n  and")}`;
                QueryUnit.createSQLTextDocument(sql);
            });
    }

    public updateSqlTemplate() {
        this
            .getChildren()
            .then((children: Node[]) => {
                const keysNames = children.filter((child: any) => child.column.key).map((child: any) => child.column.name);
                const childrenNames = children.filter((child: any) => !child.column.key).map((child: any) => child.column.name);

                const sets = childrenNames.map((name: string) => `${name} = ${name}`);
                const where = keysNames.map((name: string) => `${name} = '${name}'`);

                let sql = `update \n  ${Util.wrap(this.database)}.${Util.wrap(this.table)} \nset \n  ${sets.toString().replace(/,/g, ",\n  ")}\n`;
                sql += `where \n  ${where.toString().replace(/,/g, "\n  and ")}`;
                QueryUnit.createSQLTextDocument(sql);
            });
    }

    public backupData(exportPath: string) {

        Console.log(`Doing backup ${this.host}_${this.database}_${this.table}...`);
        mysqldump({
            connection: {
                host: this.host,
                user: this.user,
                password: this.password,
                database: this.database,
                port: parseInt(this.port),
            },
            dump: {
                tables: [this.table],
                schema: {
                    table: {
                        ifNotExist: false,
                        dropIfExist: true,
                        charset: false,
                    },
                    engine: false,
                },
            },
            dumpToFile: `${exportPath}\\${this.database}_${this.table}_${format('yyyy-MM-dd_hhmmss', new Date())}.sql`,
        }).then(() => {
            vscode.window.showInformationMessage(`Backup ${this.host}_${this.database}_${this.table} success!`);
        }).catch((err) => {
            vscode.window.showErrorMessage(`Backup ${this.host}_${this.database}_${this.table} fail!\n${err}`);
        });
        Console.log("backup end.");

    }

    public copyName(): void {
        Util.copyToBoard(this.table);
    }

}
