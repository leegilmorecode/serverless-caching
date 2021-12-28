import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";

import { v4 as uuid } from "uuid";

const data = require("data-api-client")({
  secretArn: process.env.SECRET_ARN as string,
  resourceArn: process.env.CLUSTER_ARN as string,
  database: process.env.DB,
  continueAfterTimeout: true,
  includeResultMetadata: false,
});

export const listBlogsHandler: APIGatewayProxyHandler =
  async (): Promise<APIGatewayProxyResult> => {
    try {
      const correlationId = uuid();
      const method = "list-blogs.handler";
      const prefix = `${correlationId} - ${method}`;

      console.log(`${prefix} - started`);

      const { records }: { records: BlogResponse[] } = await data.query(
        "select * from Blogs;"
      );

      const response: BlogsResponse = {
        items: records,
        responseDateTime: new Date().toUTCString(), // we add this simply to see the caching working
      };

      console.log(`${prefix} - successful: ${JSON.stringify(response)}`);

      return {
        body: JSON.stringify(response),
        statusCode: 200,
      };
    } catch (error) {
      return {
        body: "An error has occurred",
        statusCode: 500,
      };
    }
  };
