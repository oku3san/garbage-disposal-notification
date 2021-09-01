import * as Lambda from 'aws-lambda';
import * as Line from "@line/bot-sdk";
import * as Types from "@line/bot-sdk/lib/types";
import * as AWS from "aws-sdk";

// Line token
const accessToken: string = process.env.accessToken!;
const channelSecret: string = process.env.channelSecret!;

const config: Line.ClientConfig = {
  channelAccessToken: accessToken,
  channelSecret: channelSecret,
};
const client = new Line.Client(config);

// Enable Dynamodb
const documentClient = new AWS.DynamoDB.DocumentClient();
const garbageTable: string = process.env.garbageTable!;

export const handler: Lambda.APIGatewayProxyHandler = async (proxyEvent: Lambda.APIGatewayEvent, _context) => {

  // 署名確認
  const signature: any = proxyEvent.headers["x-line-signature"];
  if (!Line.validateSignature(proxyEvent.body!, channelSecret, signature)) {
    throw new Line.SignatureValidationFailed("signature validation failed", signature);
  }

  const body: Line.WebhookRequestBody = JSON.parse(proxyEvent.body!);
  await Promise
    .all(body.events.map(async event => eventHandler(event)))
    .catch(err => {
      console.error(err.Message);
      return {
        statusCode: 500,
        body: "Error"
      }
    })
  return {
    statusCode: 200,
    body: "OK"
  }
}

async function eventHandler(event: Line.WebhookEvent): Promise<any> {
  let lineMessage: Types.Message

  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  switch (event.message.text) {
    case 'はい':
      lineMessage = {type: "sticker", packageId: '6370', stickerId: '11088025'};
      await changeFinishStatus(1)
      break
    case 'いいえ':
      lineMessage = {type: "sticker", packageId: '8515', stickerId: '16581257'};
      break
    default:
      lineMessage = {type: "sticker", packageId: '8515', stickerId: '16581263'};
  }

  return client.replyMessage(event.replyToken, lineMessage);
}

const changeFinishStatus = async (statusArg: number) => {
  const todayId = getDayId()
  let id: number
  const status: number = statusArg

  // Set value for Sunday
  if(todayId === 6) {
    id = 0
  }
  else {
    id = todayId + 1
  }

  const params = {
    TableName: garbageTable,
    Key: {
      'Id': id
    },
    UpdateExpression: 'set FinishStatus = :s',
    ExpressionAttributeValues: {
      ':s' : status
    }
  }

  try {
    return await documentClient.update(params).promise()
  }
  catch(error) {
    console.error(error.message)
    throw new Error('Failed to documentClient.update');
  }
}

const getDayId = () => {
  const jstTime: Date = new Date(Date.now() + ((new Date().getTimezoneOffset() + (9 * 60)) * 60 * 1000))
  const day: number = jstTime.getDay()
  return day
}
