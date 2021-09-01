import * as Line from "@line/bot-sdk";
import * as Types from "@line/bot-sdk/lib/types";
import * as AWS from "aws-sdk";

// Line token
const accessToken: string = process.env.accessToken!;
const channelSecret: string = process.env.channelSecret!;
const userId: string = process.env.userId!;

const config: Line.ClientConfig = {
  channelAccessToken: accessToken,
  channelSecret: channelSecret,
};
const client = new Line.Client(config);

// Enable Dynamodb
const garbageTable: string = process.env.garbageTable!;
const documentClient = new AWS.DynamoDB.DocumentClient();

export const handler: any = async () => {
  try {
    await eventHandler()
    console.log('Success!')
    return {
      statusCode: 200,
      body: "OK"
    }
  }
  catch(error) {
    console.error(error.message)
    return {
      statusCode: 500,
      body: "Error"
    }
  }
}

const eventHandler: any = async () => {
  await changeFinishStatus(0)

  let itemObj: any = ''
  try {
    itemObj = await fetchGarbageData()
  }
  catch (error) {
    console.error(error.message)
    throw new Error('Failed to fetchGarbageData');
  }

  if (itemObj.Item.FinishStatus === 1) {
    console.log('Already done!')
    return
  } else {
    const dayOfWeek: number = itemObj.Item.DayOfWeek
    let lineMessage: Types.Message

    if (itemObj.Item.Garbages[0] === "") {
      lineMessage = {type: "text", text: `${dayOfWeek}のゴミはありません`}
    }
    else {
      lineMessage = {
        "type": "template",
        "altText": "今日のゴミ捨てメッセージ",
        "template": {
          "type": "confirm",
          "text": `${dayOfWeek}のゴミは以下です\n捨てましたか？\n${itemObj.Item.Garbages.join('\n')}`,
          "actions": [
            {
              "type": "message",
              "label": "はい",
              "text": "はい"
            },
            {
              "type": "message",
              "label": "いいえ",
              "text": "いいえ"
            }
          ]
        }
      }
    }

    try {
      return await client.pushMessage(userId, lineMessage)
    }
    catch (error) {
      console.error(error.message)
      throw new Error('Failed to pushMessage to Line');
    }
  }
}

const fetchGarbageData = async () => {
  const todayId = getDayId()
  let id: number

  // Set value for Sunday
  if(todayId === 6) {
    id = 0
  }
  else {
    id = todayId + 1
  }

  // Get tomorrow's garbage
  const params = {
    TableName: garbageTable,
    Key: {
      'Id': id
    }
  }

  try {
    return await documentClient.get(params).promise()
  }
  catch(error) {
    console.error(error.message)
    throw new Error('Failed to documentClient.get');
  }
}

const changeFinishStatus = async (statusArg: number) => {
  const todayId = getDayId()
  const status: number = statusArg

  const id = todayId

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
