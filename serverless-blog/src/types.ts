export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  AWSDate: string;
  AWSTime: string;
  AWSDateTime: string;
  AWSTimestamp: number;
  AWSEmail: string;
  AWSJSON: string;
  AWSURL: string;
  AWSPhone: string;
  AWSIPAddress: string;
};

export type QueryIdArgs = {
  id: Scalars["ID"];
};
export type NoArgs = {};

export type Blog = {
  __typename?: "Blog";
  id: Scalars["ID"];
  blogTitle: Scalars["String"];
  blogBody: Scalars["String"];
  blogDate: Scalars["AWSDateTime"];
};
