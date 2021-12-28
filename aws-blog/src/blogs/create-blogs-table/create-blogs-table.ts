import * as AWS from "aws-sdk";

import {
  CdkCustomResourceHandler,
  CdkCustomResourceResponse,
} from "aws-lambda";

import { v4 as uuid } from "uuid";

const rdsDataService = new AWS.RDSDataService();

export const createBlogsTableHandler: CdkCustomResourceHandler =
  async (): Promise<CdkCustomResourceResponse> => {
    try {
      const correlationId = uuid();
      const method = "create-blogs-table.handler";
      const prefix = `${correlationId} - ${method}`;

      console.log(`${prefix} - started`);

      const secretArn = process.env.SECRET_ARN as string;
      const resourceArn = process.env.CLUSTER_ARN as string;

      // create the table if it does not already exist
      const createTableSql = `CREATE TABLE IF NOT EXISTS Blogs (
    blogID int,
    blogTitle varchar(255),
    blogBody varchar(255),
    blogDate Date
    );`;

      // add some ficticious blog records
      const createRecordsSql = `
    INSERT INTO blogsdb.Blogs (blogID, blogTitle, blogBody, blogDate)
    VALUES (1, 'API Gateway 101', 'This is a dummy post on API Gateway', '2021-01-01'),
    (2, 'Getting started with Lambda', 'This is a dummy post on Lambda', '2021-02-01'),
    (3, 'DynamoDB in action', 'This is a dummy post on DynamoDB', '2021-03-01');
    `;

      const sqlParams: AWS.RDSDataService.ExecuteStatementRequest = {
        secretArn,
        resourceArn,
        sql: "",
        continueAfterTimeout: true,
        database: process.env.DB,
        includeResultMetadata: true,
      };

      // add the create table sql
      sqlParams["sql"] = createTableSql;

      console.log(`${prefix} - creating table`);

      await rdsDataService.executeStatement(sqlParams).promise();

      console.log(`${prefix} - creating records`);

      // add the creation of the blog records
      sqlParams["sql"] = createRecordsSql;

      const {
        numberOfRecordsUpdated,
      }: AWS.RDSDataService.Types.ExecuteStatementResponse = await rdsDataService
        .executeStatement(sqlParams)
        .promise();

      console.log(
        `${prefix} - successfully created ${numberOfRecordsUpdated} records`
      );

      return {
        success: true,
      };
    } catch (error) {
      console.error(error);
      throw error;
    }
  };
