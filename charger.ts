import {
  WebSocketClient,
  StandardWebSocketClient,
} from "https://deno.land/x/websocket@v0.1.3/mod.ts";
import { parse } from "https://deno.land/std@0.181.0/flags/mod.ts";
import { faker } from "https://deno.land/x/deno_faker@v1.0.3/mod.ts";

class Queue {
  items: string[];
  constructor() {
    this.items = [];
  }

  enqueue(element: string) {
    this.items.push(element);
  }
  dequeue() {
    if (this.isEmpty()) return "Underflow";
    return this.items.shift();
  }
  front() {
    if (this.isEmpty()) return "No elements in Queue";
    return this.items[0];
  }
  frontMessageId() {
    if (this.isEmpty()) return "No elements in Queue";
    return JSON.parse(this.items[0])[1];
  }
  frontEventType() {
    if (this.isEmpty()) return "No elements in Queue";
    return JSON.parse(this.items[0])[2];
  }
  isEmpty() {
    return this.items.length === 0;
  }
  printQueue() {
    var str = "";
    for (var i = 0; i < this.items.length; i++) str += this.items[i] + " ";
    return str;
  }
}

enum EventType {
  BOOT_NOTIFICATION = "BootNotification",
  METER_VALUES = "MeterValues",
  STOP_TRANSACTION = "StopTransaction",
  START_TRANSACTION = "StartTransaction",
  STATUS_NOTIFICATION = "StatusNotification",
  AUTHORIZE = "Authorize",
  REMOTE_START_TRANSACTION = "RemoteStartTransaction",
  REMOTE_STOP_TRANSACTION = "RemoteStopTransaction",
}

const runningSessions = new Map();

const queue = new Queue();

let lock = false;
console.log(Deno.env.toObject())

const endpoint = `${Deno.env.get('WEBSOCKET')}`;
console.log(`Connecting to ${endpoint}`);

const ws: WebSocketClient = new StandardWebSocketClient(endpoint);
ws.on("open", async function () {
  queue.enqueue(
    buildPayload(bootNotificationMessage(), EventType.BOOT_NOTIFICATION)
  );
  queue.enqueue(
    buildPayload(
      statusNotificationMessage(0, "Available"),
      EventType.STATUS_NOTIFICATION
    )
  );
  queue.enqueue(
    buildPayload(
      statusNotificationMessage(1, "Available"),
      EventType.STATUS_NOTIFICATION
    )
  );
  //onAuthorisation(args.r);
  queue.enqueue(
    buildPayload(
      statusNotificationMessage(2, "Available"),
      EventType.STATUS_NOTIFICATION
    )
  );
  queue.enqueue(
    buildPayload(
      statusNotificationMessage(3, "Available"),
      EventType.STATUS_NOTIFICATION
    )
  );
  while (true) {
    await new Promise((r) => setTimeout(r, +Deno.env.get('DELAY')!));
    if (!queue.isEmpty() && !lock) {
      const reply = queue.front();
      console.log(`OUT|${reply}`);
      ws.send(reply);
      lock = true;
    }
  }
});
ws.on("message", function (message: any) {
  console.log(`IN|${message.data}`);
  const data = JSON.parse(message.data);
  switch (data[0]) {
    case 4:
      throw new Error("Invalid Message is received");
    case 3:
      if (data[1] === queue.frontMessageId()) {
        validateResponseAndTriggerNext(queue.frontEventType(), data[2]);
        queue.dequeue();
        lock = false;
      } else throw new Error("Unaccounted Message Detected");
      break;
    case 2: {
      const isValid = validateRemoteActions(data[3], data[2]);
      let reply = "";
      if (isValid) reply = `[3, "${data[1]}", {"status": "Accepted"}]`;
      else reply = `[3, "${data[1]}", {"status": "Rejected"}]`;
      console.log(`OUT|${reply}`);
      ws.send(reply);
      break;
    }
  }
});

const onAuthorisation = (idTag: string) => {
  queue.enqueue(buildPayload(authorizeMessage(idTag), EventType.AUTHORIZE));
};

const startCharging = (idTag: string, connector: number) => {
  queue.enqueue(
    buildPayload(
      statusNotificationMessage(connector, "Preparing"),
      EventType.STATUS_NOTIFICATION
    )
  );
  queue.enqueue(
    buildPayload(
      statusNotificationMessage(connector, "Charging"),
      EventType.STATUS_NOTIFICATION
    )
  );
  runningSessions.set(connector, { idTag: idTag, meterValue: 0 });
  queue.enqueue(
    buildPayload(
      startTransactionMessage(connector, idTag, 0),
      EventType.START_TRANSACTION
    )
  );
};

const sendMeterValue = (connector: number, tranactionId: number) => {
  const connectorSession = runningSessions.get(connector);
  connectorSession.meterValue = connectorSession.meterValue + randomIntFromInterval(+Deno.env.get('MIN_METER')!, +Deno.env.get('MAX_METER')!);
  runningSessions.set(connector, connectorSession);
  if (connectorSession.meterValue >= +args.m ?? 25)
    stopTransaction(tranactionId, connector, connectorSession.meterValue);
  else
    queue.enqueue(
      buildPayload(
        meterValueMessage(tranactionId, connector, connectorSession.meterValue),
        EventType.METER_VALUES
      )
    );
};

const stopTransaction = (
  transactionId: number,
  connectorId: number,
  meterValue: number
) => {
  queue.enqueue(
    buildPayload(
      statusNotificationMessage(connectorId, "Finishing"),
      EventType.STATUS_NOTIFICATION
    )
  );
  queue.enqueue(
    buildPayload(
      stopTransactionMessage(meterValue, transactionId),
      EventType.STOP_TRANSACTION
    )
  );
  queue.enqueue(
    buildPayload(
      statusNotificationMessage(connectorId, "Available"),
      EventType.STATUS_NOTIFICATION
    )
  );
};

const validateResponseAndTriggerNext = (eventType: EventType, message: any) => {
  switch (eventType) {
    case EventType.AUTHORIZE:
      if (message.idTagInfo.status === "Accepted") startCharging(args.r, 1);
      else throw new Error("IdTag rejected");
      break;
    case EventType.START_TRANSACTION: {
      const connectorId = JSON.parse(queue.front())[3].connectorId;
      const connectorSession = runningSessions.get(connectorId);
      connectorSession.transactionId = message.transactionId;
      runningSessions.set(connectorId, connectorSession);
      if (message.idTagInfo.status === "Accepted") {
        sendMeterValue(connectorId, connectorSession.transactionId);
      } else
        stopTransaction(
          connectorSession.transactionId,
          connectorId,
          connectorSession.meterValue
        );
      break;
    }
    case EventType.METER_VALUES:
      runningSessions.forEach((v, k) => sendMeterValue(k, v.transactionId));
      break;
    case EventType.STOP_TRANSACTION:
      runningSessions.forEach((v, k, m) => {
        if (v.transactionId === JSON.parse(queue.front())[3].transactionId)
          m.delete(k);
      });
      break;
    case EventType.STATUS_NOTIFICATION:
      break;
    case EventType.BOOT_NOTIFICATION:
      if (message.status === "Accepted") {
        if (args.p === "RFID") onAuthorisation(args.r);
      } else
        queue.enqueue(
          buildPayload(bootNotificationMessage(), EventType.BOOT_NOTIFICATION)
        );
  }
};

const validateRemoteActions = (message: any, event: EventType): boolean => {
  switch (event) {
    case EventType.REMOTE_START_TRANSACTION:
      if (runningSessions.has(message.connectorId)) return false;
      else {
        startCharging(message.idTag, message.connectorId);
        return true;
      }
    case EventType.REMOTE_STOP_TRANSACTION:
      for (const [key, value] of runningSessions) {
        if (runningSessions.get(key).transactionId === message.transactionId) {
          stopTransaction(value.transactionId, key, value.meterValue);
          return true;
        }
      }
      return false;
    default:
      return false;
  }
};

function bootNotificationMessage(): string {
  const version = `v${faker.random.number({
    min: 1,
    max: 10,
  })}.${faker.random.number({ min: 1, max: 10 })}.${faker.random.number({
    min: 1,
    max: 10,
  })}`;
  return `{"chargePointVendor":"${faker.company.companyName()}", "chargePointModel":"${faker.commerce.productName()}", "chargePointSerialNumber":"${faker.random.alphaNumeric(10)}", "firmwareVersion":"${version}", "meterType":"${faker.company.companyName()}", "meterSerialNumber":"${faker.random.alphaNumeric(10)}", "iccid": "${faker.internet.ip()}", "chargeBoxSerialNumber": "${faker.random.alphaNumeric(10)}", "imsi": "${faker.random.alphaNumeric(10)}" }`;
}

function startTransactionMessage(
  connectorId: number,
  idTag: string,
  meterStart: number
) {
  return `{"connectorId":${connectorId}, "idTag":"${idTag}", "meterStart":${meterStart},"timestamp":"${getDateTime()}"}`;
}

function authorizeMessage(idTag: string) {
  return `{ "idTag":"${idTag}" }`;
}

function meterValueMessage(
  transactionId: number,
  connectorId: number,
  meterValue: number
): string {
  return `{ "connectorId":${connectorId},"transactionId":${transactionId},"meterValue": [{ "timestamp": "${getDateTime()}", "sampledValue" : [{"value":"${meterValue}","context":"Sample.Periodic","measurand":"Energy.Active.Import.Register","unit":"Wh"}] }]}`;
}

function stopTransactionMessage(meterValue: number, transactionId: number) {
  return `{ "meterStop":${meterValue}, "timestamp":"${getDateTime()}", "transactionId":${transactionId}, "reason":"Remote" }`;
}

function statusNotificationMessage(connectorId: number, status: string) {
  return `{ "connectorId":${connectorId}, "errorCode":"NoError", "info":"${faker.lorem.words()}", "status":"${status}", "timestamp":"${getDateTime()}"}`;
}

function getDateTime() {
  return new Date().toISOString();
}

const buildPayload = (message: string, action: string): string => {
  const msgId = crypto.randomUUID();
  return `[2, "${msgId}", "${action}", ${message}]`;
};

function randomIntFromInterval(min: number, max: number) {
  // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}
