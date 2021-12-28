import * as AWS from "aws-sdk";

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";

import { v4 as uuid } from "uuid";

const fs = require("fs").promises;
const s3 = new AWS.S3();

// a function to write the files to tmp on the lambda
async function writeFilesToTemp(files: CompanyLogos): Promise<void> {
  console.log(`writing cached files to /tmp`);

  const promises = files.map((file: CompanyLogo) => {
    return fs.writeFile(`/tmp/${file.key}`, file.logo);
  });

  await Promise.all(promises);
}

// a function to read the cached files from tmp
async function readFilesFromTemp(): Promise<CompanyLogos> {
  const filesList: string[] = await fs.readdir("/tmp/");

  return await Promise.all(
    filesList.map(async (fileName: string) => {
      const file: Buffer = await fs.readFile(`/tmp/${fileName}`);
      return {
        key: fileName,
        logo: Buffer.from(file).toString(),
      };
    })
  );
}

// a function to pull the files from an s3 bucket before caching them locally
async function readFilesFromS3Bucket() {
  const downloadedFiles: CompanyLogos = [];

  // list the objects in the s3 bucket
  const { Contents: contents = [] }: AWS.S3.ListObjectsV2Output = await s3
    .listObjectsV2({ Bucket: bucketName })
    .promise();

  // get each of the objects from the list
  for (const file of contents) {
    const object: AWS.S3.GetObjectOutput = await s3
      .getObject({ Key: file.Key as string, Bucket: bucketName })
      .promise();

    downloadedFiles.push({
      key: file.Key as string,
      logo: object.Body?.toString("base64") as string,
    });
  }

  return downloadedFiles;
}

const bucketName = process.env.BUCKET as string;

// set this defaulted to false, and set to true when files are cached to tmp
let filesCached = false;

// Note: the related api gateway endpoint does not have caching enabled
export const listLogosCachedInTmpHandler: APIGatewayProxyHandler =
  async (): Promise<APIGatewayProxyResult> => {
    try {
      const correlationId = uuid();
      const method = "list-company-logos.handler";
      const prefix = `${correlationId} - ${method}`;

      console.log(`${prefix} - started`);

      if (filesCached) {
        console.log(`${prefix} files are cached - read from tmp on Lambda`);

        const companyLogos: CompanyLogos = await readFilesFromTemp();

        return {
          body: JSON.stringify(companyLogos),
          statusCode: 200,
        };
      } else {
        console.log(
          `${prefix} files are not cached - read from s3 bucket and cache in tmp`
        );
        const companyLogos: CompanyLogos = await readFilesFromS3Bucket();
        await writeFilesToTemp(companyLogos);

        filesCached = true; // set cached to true

        return {
          body: JSON.stringify(companyLogos),
          statusCode: 200,
        };
      }
    } catch (error) {
      return {
        body: "An error has occurred",
        statusCode: 500,
      };
    }
  };
