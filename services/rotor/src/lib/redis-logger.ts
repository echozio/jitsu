import { getLog, getSingleton } from "juava";
import { EventsStore } from "@jitsu/protocols/functions";
import { redis } from "./redis";

export const log = getLog("redisLogger");

const eventsLogSize = process.env.EVENTS_LOG_MAX_SIZE ? parseInt(process.env.EVENTS_LOG_MAX_SIZE) : 1000;

export const redisLogger = getSingleton("redisLogger", createRedisLogger);

export function createRedisLogger(): EventsStore {
  const buffer: Record<string, string[]> = {};

  const put = (key: string, logEntry: string) => {
    let buf = buffer[key];
    if (!buf) {
      buffer[key] = buf = [];
    }
    if (buf.length < eventsLogSize) {
      buf.push(logEntry);
    }
  };

  const flush = async () => {
    if (Object.keys(buffer).length === 0) {
      return;
    }
    const copy = { ...buffer };
    for (const key in buffer) {
      delete buffer[key];
    }
    try {
      const pipeline = redis().pipeline();
      for (const [key, buf] of Object.entries(copy)) {
        for (let i = 0; i < buf.length; i++) {
          const logEntry = buf[i];
          if (i === buf.length - 1) {
            log.atDebug().log(`Posting ${buf.length} events to stream [${key}]`);
            pipeline.xadd(key, "MAXLEN", "~", eventsLogSize, "*", "event", logEntry);
          } else {
            pipeline.xadd(key, "*", "event", logEntry);
          }
        }
      }
      await pipeline.exec();
    } catch (e) {
      log.atError().withCause(e).log(`Failed to flush events logs to redis`);
    }
  };

  setInterval(async () => {
    if (Object.keys(buffer).length === 0) {
      return;
    }
    await flush();
  }, 5000);

  return {
    log: (connectionId: string, error, msg) => {
      const key = (isErr: boolean) => `events_log:functions.${isErr ? "error" : "all"}#${connectionId}`;
      try {
        if (msg.type === "log-debug") {
          return;
        }
        const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), error, ...msg });
        if (error) {
          put(key(true), logEntry);
        }
        put(key(false), logEntry);
      } catch (e) {
        log.atError().withCause(e).log("Failed to put event to redis events log");
      }
    },
  };
}
