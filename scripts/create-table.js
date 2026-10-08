// Creates the table in DynamoDB Local (same keys as template.yaml).
import { DynamoDBClient, CreateTableCommand, ResourceInUseException } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({
  endpoint: process.env.DDB_ENDPOINT || 'http://localhost:8000',
  region: 'ap-south-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const TableName = process.env.TABLE_NAME || 'quenchsip';

try {
  await client.send(
    new CreateTableCommand({
      TableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    })
  );
  console.log(`Created table ${TableName}`);
} catch (err) {
  if (err instanceof ResourceInUseException) console.log(`Table ${TableName} already exists`);
  else throw err;
}
