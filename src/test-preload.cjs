// cspell:ignore Uncloneable
// undici v8 calls worker_threads.markAsUncloneable (added in Node 22.1).
// Shim it for Node 20 so jsdom can load during tests.
"use strict";
const wt = require("node:worker_threads");
if (typeof wt.markAsUncloneable !== "function") {
  wt.markAsUncloneable = () => {};
}
