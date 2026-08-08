// ===========================================================================
// test/harness.js — Loads the REAL extension sources into a sandbox
// ===========================================================================
// The previous suites pasted copies of the production logic into the test
// file, so every one of the Critical/High defects passed 233 "green"
// assertions. Here the actual files are evaluated in a vm context with
// minimal Chrome/DOM stubs, so drift between source and test is impossible.
// ===========================================================================

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', 'file-to-markdown-extension');

class StorageArea {
  constructor(data) {
    this.data = { ...data };
    this.listeners = [];
  }

  get(keys, callback) {
    const result = keys === null || keys === undefined ? { ...this.data }
      : typeof keys === 'string' ? (keys in this.data ? { [keys]: this.data[keys] } : {})
        : Object.fromEntries(Object.keys(keys).map((k) => [k, this.data[k]]));
    if (callback) { callback(result); return undefined; }
    return Promise.resolve(result);
  }

  set(patch, callback) {
    const changes = {};
    for (const [key, value] of Object.entries(patch)) {
      changes[key] = { oldValue: this.data[key], newValue: value };
      this.data[key] = value;
    }
    for (const listener of this.listeners) listener(changes, 'local');
    if (callback) { callback(); return undefined; }
    return Promise.resolve();
  }
}

function chromeStub(storage) {
  const registered = [];
  const messages = [];
  return {
    registered,
    messages,
    storage: { local: storage, onChanged: { addListener: (fn) => storage.listeners.push(fn) } },
    runtime: {
      getURL: (p) => 'chrome-extension://ftm/' + p,
      getManifest: () => ({ version: '3.0.0' }),
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onSuspend: { addListener: () => {} },
      onConnect: { addListener: (fn) => { registered.push(fn); } },
      connect: () => ({ postMessage: (m) => messages.push(m), disconnect: () => {}, onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} } })
    },
    scripting: {
      registerContentScripts: async (specs) => { registered.push(...specs); },
      unregisterContentScripts: async () => {}
    },
    tabs: { query: async () => [], sendMessage: async () => {} }
  };
}

// Loads the given extension-relative files into one shared sandbox.
function load(files, options = {}) {
  const storage = new StorageArea(options.storage || {});
  const chrome = chromeStub(storage);
  const sandbox = {
    console,
    performance,
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    Blob,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome,
    crypto,
    location: { hostname: options.hostname || 'example.com' }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const evaluate = (file) => {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    new vm.Script(code, { filename: file }).runInContext(context);
  };
  sandbox.importScripts = (...paths) => { for (const p of paths) evaluate(p); };
  for (const file of files) evaluate(file);
  const run = (code) => new vm.Script(code, { filename: 'inline' }).runInContext(context);
  return { FTM: sandbox.FTM, sandbox, chrome, storage, run };
}

// Simple DOMParser mock for offscreen document testing
class MockDOMParser {
  parseFromString() {
    // Very minimal implementation for testing purposes
    return {
      querySelector: () => null,
      querySelectorAll: () => [],
      body: null,
      documentElement: null
    };
  }
}

// Load function with DOMParser for offscreen documents that need it
function loadWithDOMParser(files, options = {}) {
  const storage = new StorageArea(options.storage || {});
  const chrome = chromeStub(storage);
  const sandbox = {
    console,
    performance,
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    Blob,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome,
    crypto,
    location: { hostname: options.hostname || 'example.com' },
    DOMParser: MockDOMParser  // Use mock DOMParser for testing
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const evaluate = (file) => {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    new vm.Script(code, { filename: file }).runInContext(context);
  };
  sandbox.importScripts = (...paths) => { for (const p of paths) evaluate(p); };
  for (const file of files) evaluate(file);
  const run = (code) => new vm.Script(code, { filename: 'inline' }).runInContext(context);
  return { FTM: sandbox.FTM, sandbox, chrome, storage, run };
}

const SHARED = ['shared/constants.js', 'shared/text.js', 'shared/config.js'];

function loadShared(options) {
  return load(SHARED, options);
}

function loadContent(options) {
  return load([...SHARED, 'content/config.js', 'content/activation.js', 'content/postprocess.js', 'content/history.js'], options);
}

function loadArchives(options) {
  return loadWithDOMParser([...SHARED, 'offscreen/archives.js'], options);
}

module.exports = { load, loadShared, loadContent, loadArchives, loadWithDOMParser, SHARED, ROOT };
