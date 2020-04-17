export interface ConnectionInfo {
    readonly host: string;
    readonly user: string;
    password?: string;
    readonly port: string;
    database?: string;
    multipleStatements?: boolean;
    readonly certPath: string;

}