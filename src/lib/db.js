import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const TABLE = process.env.TABLE_NAME || 'quench';

// DDB_ENDPOINT points at DynamoDB Local for development; unset in Lambda.
const local = process.env.DDB_ENDPOINT
  ? {
      endpoint: process.env.DDB_ENDPOINT,
      region: process.env.AWS_REGION || 'ap-south-1',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }
  : {};

export const db = DynamoDBDocumentClient.from(new DynamoDBClient(local), {
  marshallOptions: { removeUndefinedValues: true },
});
