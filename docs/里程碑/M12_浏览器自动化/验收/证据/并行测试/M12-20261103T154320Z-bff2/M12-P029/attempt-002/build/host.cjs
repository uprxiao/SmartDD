"use strict";
const electron = require("electron");
const Database = require("better-sqlite3");
const node_fs = require("node:fs");
const promises = require("node:fs/promises");
const node_http = require("node:http");
const node_crypto = require("node:crypto");
const node_path = require("node:path");
const ws = require("ws");
const node_child_process = require("node:child_process");
const promises$1 = require("node:timers/promises");
const node_os = require("node:os");
const node_net = require("node:net");
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
class Cached {
  constructor(getter) {
    this._getter = getter;
    this._value = void 0;
  }
  get value() {
    const getter = this._getter;
    if (getter !== void 0) {
      this._value = getter();
      this._getter = void 0;
    }
    return this._value;
  }
}
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys2, wrap) {
  const raw2 = sourceShape(source);
  for (const key of keys2) {
    const desc = Object.getOwnPropertyDescriptor(raw2, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
const propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
  });
}
const NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
const BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema, maskedKeys(schema, mask));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  const raw2 = sourceShape(schema);
  const keys2 = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw2, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys2.push(key);
  }
  return keys2;
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema, mask));
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask, name = "partial") {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({ type: "optional", innerType: value })));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required$1(Class, schema, mask) {
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => (
    // overwrite with non-optional
    selected && !selected.has(key) ? value : new Class({ type: "nonoptional", innerType: value })
  ));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path2, issues) {
  return issues.map((iss) => {
    var _a2;
    (_a2 = iss).path ?? (_a2.path = []);
    iss.path.unshift(path2);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function sizeCaps(defChecks) {
  const caps = [];
  for (const ch of defChecks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    const max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a2;
  for (let i = start; i < issues.length; i++) {
    (_a2 = issues[i]).schema ?? (_a2.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config2) {
  var _a2;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a2 = iss).schema ?? (_a2.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
const highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0; i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
let installing;
let broke = false;
const breaker = {
  configurable: true,
  get() {
    broke = true;
    return void 0;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: void 0 };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
const CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}
var _a$1;
const _zodDesc = { value: void 0, enumerable: false };
let _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition();
}
function $constructor(name, initializer2, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer2(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _.prototype;
    for (const k in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto2[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}
class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
const _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
const _issuesDesc = { value: void 0, enumerable: false };
const _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
const initializer$1 = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = void 0;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
const $ZodError = $constructor("$ZodError", initializer$1);
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error2.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error3, path2 = []) => {
    for (const issue2 of error3.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path2, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path2, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path2, ...issue2.path]);
      } else {
        const fullpath = [...path2, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue2));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node2 = curr[el];
            if (terminal) {
              node2._errors.push(mapper(issue2));
            }
            curr = node2;
            i++;
          }
        }
      }
    }
  };
  processError(error2);
  return fieldErrors;
}
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
const _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError();
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
const _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
const _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
function failure(Err, issues, ctx) {
  let error2;
  return {
    success: false,
    get error() {
      if (!error2) {
        error2 = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = void 0;
        ctx = void 0;
      }
      return error2;
    },
    set error(e) {
      error2 = e;
      issues = void 0;
      ctx = void 0;
    }
  };
}
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
const COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
const COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
const validate = ((schema, value, _ctx) => {
  const validator = schema._zod.bag.validator;
  if (validator !== void 0) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === void 0)
      return false;
  }
  return validateFallback(schema, value, _ctx);
});
function validateFallback(schema, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length === 0;
}
const validateAsync$1 = async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
};
const _encode = (_Err) => {
  const parse2 = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse2(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
const _decode = (_Err) => {
  const parse2 = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    return parse2(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
const _encodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync2(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
const _decodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    return await parseAsync2(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
const _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
const _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
const duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const uuid$1 = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
const email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
  return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function anchor(source) {
  return new RegExp(`^${source}$`);
}
const date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts = ["Z"];
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const anyString = /^[\s\S]{0,}$/;
const bigint$1 = /^-?\d+n?$/;
const integer$1 = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const boolean$1 = /^(?:true|false)$/i;
const _null$2 = /^null$/i;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;
const $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a2;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a2 = inst._zod).onattach ?? (_a2.onattach = []);
});
const _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== void 0;
};
const numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
const $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin2 = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin2,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin2 = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin2,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? (
      // `value % 0n` throws, and nothing is a multiple of zero — the number branch already fails this way via NaN
      def.value !== BigInt(0) && payload.value % def.value === BigInt(0)
    ) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin2 = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin2,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin: origin2,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin: origin2,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
const $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units > def.maximum ? codePointLength(input) : units;
    if (length <= def.maximum)
      return;
    const origin2 = getLengthableOrigin(input);
    payload.issues.push({
      origin: origin2,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units;
    if (length >= def.minimum)
      return;
    const origin2 = getLengthableOrigin(input);
    payload.issues.push({
      origin: origin2,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
    if (length === def.length)
      return;
    const origin2 = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin: origin2,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a2, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a2 = inst._zod).check ?? (_a2.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
const $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function handleCheckPropertyResult(result, payload, property) {
  if (result.issues.length) {
    payload.issues.push(...prefixIssues(property, result.issues));
  }
}
const $ZodCheckProperties = /* @__PURE__ */ $constructor("$ZodCheckProperties", (inst, def) => {
  $ZodCheck.init(inst, def);
  hide(inst, Symbol.iterator, function* () {
    yield inst;
  });
  let entries;
  inst._zod.check = (payload) => {
    if (payload.value == null) {
      payload.issues.push({ expected: "object", code: "invalid_type", input: payload.value, inst });
      return void 0;
    }
    entries ?? (entries = Reflect.ownKeys(def.shape).map((key) => [key, def.shape[key]]));
    const input = payload.value;
    let proms;
    for (const [key, schema] of entries) {
      const result = schema._zod.run({ value: input[key], issues: [] }, {});
      if (result instanceof Promise) {
        proms ?? (proms = []);
        proms.push(result.then((result2) => handleCheckPropertyResult(result2, payload, key)));
      } else {
        handleCheckPropertyResult(result, payload, key);
      }
    }
    if (proms)
      return Promise.all(proms).then(() => void 0);
    return void 0;
  };
});
const $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});
class Doc {
  constructor(args = [], closed = {}) {
    this.content = [];
    this.indent = 0;
    this.args = args;
    this.closed = closed;
  }
  // the compiler catches a child's throw and keeps writing into this doc, so the indent has to unwind with it
  indented(fn) {
    this.indent += 1;
    try {
      fn(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const content = this?.content ?? [``];
    const factory = new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join("\n")}
};`);
    return factory(...Object.values(this.closed));
  }
}
const version$1 = {
  major: 4,
  minor: 6,
  patch: 7
};
const $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a2;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version$1;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
const toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {
      }
      return validateAsync(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
const $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
const $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
const $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
const $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid$1(v));
  } else
    def.pattern ?? (def.pattern = uuid$1());
  $ZodStringFormat.init(inst, def);
});
const $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
const URL_BAD_FORMAT = 1;
const URL_UNPARSEABLE = 2;
function canParseURL(input) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input);
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed2, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed2) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed2, def);
}
function parseURLObject(trimmed2, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed2)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed2) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed2);
  } catch {
    return URL_UNPARSEABLE;
  }
}
const asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url2, hostname) {
  hostname.lastIndex = 0;
  return hostname.test(url2.hostname);
}
function urlProtocolOk(url2, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url2.protocol.endsWith(":") ? url2.protocol.slice(0, -1) : url2.protocol);
}
const $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed2 = payload.value.trim();
      const url2 = validateURL(trimmed2, def);
      if (url2 === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url2 === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url2 === true) {
        payload.value = stripTabAndNewline(trimmed2);
        return;
      }
      if (def.hostname && !urlHostnameOk(url2, def.hostname)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      if (def.protocol && !urlProtocolOk(url2, def.protocol)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid protocol",
          pattern: def.protocol.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      payload.value = def.normalize ? url2.href : stripTabAndNewline(trimmed2);
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
const $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1))
    throw new Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
  $ZodStringFormat.init(inst, def);
});
const $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
const $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
const $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
const $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
});
const ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
const $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
const $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
const $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
const base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
const $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
const $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
const $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number$1;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
const $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
const $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean$1;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
const $ZodBigInt = /* @__PURE__ */ $constructor("$ZodBigInt", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = bigint$1;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = BigInt(payload.value);
      } catch (_) {
      }
    if (typeof payload.value === "bigint")
      return payload;
    payload.issues.push({
      expected: "bigint",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
const $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _null$2;
  inst._zod.values = /* @__PURE__ */ new Set([null]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input === null)
      return payload;
    payload.issues.push({
      expected: "null",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
const $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
const $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function capSize(inst, size) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  const cap = Math.min(...caps.map((c) => c[0]));
  const parse2 = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, ch] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && ch._zod.def.when(payload)) {
          const start = payload.issues.length;
          ch._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse2(payload, ctx);
  };
}
const arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index2) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index2, result.issues));
  }
  final.value[index2] = result.value;
}
const $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
  capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
const NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys2 = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys2, ...symbolKeys] : keys2;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(keys2),
    numKeys: keys2.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
const $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, /* @__PURE__ */ new Set());
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== void 0)
          propValues[key].add(void 0);
      }
    }
    return propValues;
  });
  const isObject$1 = isObject;
  const catchall = def.catchall;
  let value;
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject$1(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
const $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const memo2 = globalConfig.memoizer;
  const generateFastpass = (shape) => {
    const normalized = _normalized.value;
    const syms = normalized.symbolKeys;
    const doc = new Doc(["payload", "ctx"], { shape, inst, memo: memo2, syms });
    const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    const prefixStr = (id2, k) => `
          let ${id2}_ab = false;
          for (let i = 0; i < ${id2}.issues.length; i++) {
            const iss = ${id2}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id2}_ab = true;
          }
          if (${id2}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.allKeys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(memo2 ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
    for (const key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      const id2 = ids[key];
      const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
      const isPresent = `${k} in input`;
      const schema = shape[key];
      const optin = schema?._zod?.optin;
      const isOptionalIn = optin !== void 0;
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id2} = ${parseStr(k)};`);
      if (isOptionalIn && isOptionalOut) {
        const assign = optin === "optional" ? `${id2}_present` : `${id2}.value !== undefined || ${id2}_present`;
        doc.write(`
        const ${id2}_present = ${isPresent};
        if (!${id2}.issues.length || ${id2}_present) {
          if (${id2}.issues.length) {${prefixStr(id2, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id2}.value;
          }
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id2}_present = ${isPresent};
        if (${id2}.issues.length) {${prefixStr(id2, k)}
        }
        if (!${id2}_present && !${id2}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id2}_present) {
          newResult[${k}] = ${id2}.value;
        }

      `);
      } else {
        doc.write(`
        if (${id2}.issues.length) {${prefixStr(id2, k)}
        }
      `);
        if (optin === "defaulted") {
          doc.write(`newResult[${k}] = ${id2}.value;`);
        } else {
          doc.write(`
        if (${id2}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id2}.value;
        }
      `);
        }
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    return doc.compile();
  };
  let fastpass;
  const isObject$1 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval$1 = allowsEval;
  const fastEnabled = jit && allowsEval$1.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject$1(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
const $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
function discriminatorMap(def) {
  const map = /* @__PURE__ */ new Map();
  for (const option of def.options) {
    const values = option._zod.propValues?.[def.discriminator];
    if (!values || values.size === 0)
      throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
    for (const value of values) {
      if (map.has(value)) {
        if (value !== void 0)
          throw new Error(`Duplicate discriminator value "${String(value)}"`);
        map.set(value, null);
      } else {
        map.set(value, option);
      }
    }
  }
  return map;
}
const $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazyInternal(inst, "propValues", (zod) => {
    const propValues = {};
    let undefinedCount = 0;
    for (const option of zod.def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
      if (pv[zod.def.discriminator]?.has(void 0))
        undefinedCount++;
      for (const [k, v] of Object.entries(pv)) {
        if (!Object.prototype.hasOwnProperty.call(propValues, k)) {
          assignProp(propValues, k, /* @__PURE__ */ new Set());
        }
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    if (!zod.def.unionFallback && undefinedCount > 1)
      propValues[zod.def.discriminator]?.delete(void 0);
    return propValues;
  });
  def.options.forEach((option, i) => {
    const propShape = rawShape(option._zod.def);
    if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) {
      throw new Error(`Invalid discriminated union option at index "${i}"`);
    }
  });
  const disc = cached(() => discriminatorMap(def));
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const value = input?.[def.discriminator];
    const opt = disc.value.get(value);
    if (opt && (value !== void 0 || ctx.direction !== "backward")) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()).filter((value2) => disc.value.get(value2) !== null),
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
const $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index2 = 0; index2 < a.length; index2++) {
      const itemA = a[index2];
      const itemB = b[index2];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index2, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  const keyIssues = /* @__PURE__ */ new Map();
  const collect = (iss, side) => {
    let keys2;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys2 = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys2 = [k];
    } else {
      return false;
    }
    for (const k of keys2) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k of bothKeys) {
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
const $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values && !def.partial) {
      payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
      const recordKeys = /* @__PURE__ */ new Set();
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          if (key === "__proto__")
            continue;
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          if (outKey === "__proto__")
            continue;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[outKey] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          if (def.mode === "loose") {
            if (key === "__proto__")
              continue;
            payload.value[key] = input[key];
          } else {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          }
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    } else {
      payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
      let unrecognized;
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number$1.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else if (values) {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const outKey = keyResult.value;
        if (outKey === "__proto__")
          continue;
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[outKey] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[outKey] = result.value;
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
const $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
const $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const values = new Set(def.values);
  inst._zod.values = values;
  defineLazyInternal(inst, "pattern", (zod) => {
    const vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
const $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? void 0 : result.value;
  return payload;
}
const $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result2) => handleOptionalResult(payload, result2));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
const $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => {
    const v = zod.def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
const $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleCatchResult(payload, result2, def, ctx));
    }
    return handleCatchResult(payload, result, def, ctx);
  };
});
const $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
const $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
const $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
class $ZodCyclicError extends Error {
  constructor() {
    super(`Cannot parse a reference cycle that closes through a transform`);
    this.name = "ZodCyclicError";
  }
}
const STATE = "~memo";
const NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
const recursive = /* @__PURE__ */ new WeakMap();
const NONE = 0;
const ASSUMED = 1;
const PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  const cached2 = recursive.get(inst);
  if (cached2 !== void 0)
    return cached2 ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (!desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge2 = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw2 = rawShape(def);
      merge2(raw2 ? shape(raw2) : ASSUMED);
      check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType);
      check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left);
      check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in);
      check(def.out);
      break;
    case "function":
      check(def.input);
      check(def.output);
      break;
    // `$ZodLazy` caches its inner on the def, so a resolved edge is followed exactly
    case "lazy": {
      const inner = def._cachedInner ?? void 0;
      merge2(inner ? isRecursive(inner, stack) : ASSUMED);
      break;
    }
    // a leaf by choice: `parts` are regex fragments, not data positions
    case "template_literal":
    // leaves
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (const el of value)
            check(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state2, inst) {
  let bucket = state2.buckets.get(inst);
  if (!bucket) {
    bucket = /* @__PURE__ */ new WeakMap();
    state2.buckets.set(inst, bucket);
  }
  return bucket;
}
let handoff;
const open = [];
const memo = {
  alloc(_inst, payload, empty) {
    const bucket = handoff;
    if (!bucket)
      return empty;
    handoff = void 0;
    const entry = { value: empty, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty;
  },
  guard(inst) {
    var _a2;
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError();
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a2;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === void 0) {
          const walked = isRecursive(inst, /* @__PURE__ */ new Set());
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state2 = ctx[STATE];
        if (!state2) {
          state2 = { buckets: /* @__PURE__ */ new WeakMap(), backEdges: void 0 };
          ctx[STATE] = state2;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state2, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state2.backEdges ?? (state2.backEdges = /* @__PURE__ */ new WeakSet());
            state2.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = void 0;
        const entry = open.length > depth ? open.pop() : void 0;
        if (result instanceof Promise) {
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}
const error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin2) {
    return Sizable[origin2] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    // Compatibility: "nan" -> "NaN" for display
    nan: "NaN"
    // All other type names omitted - they fall back to raw values via ?? operator
  };
  function getTypeName(type, input) {
    if (type === "number" && typeof input === "number" && !Number.isFinite(input)) {
      return String(input);
    }
    return TypeDictionary[type] ?? type;
  }
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = getTypeName(issue2.expected);
        const receivedType = parsedType(issue2.input);
        const received = getTypeName(receivedType, issue2.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        if (issue2.options && Array.isArray(issue2.options) && issue2.options.length > 0) {
          const opts = issue2.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        if (issue2.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en() {
  return {
    localeError: error()
  };
}
var _a;
class $ZodRegistry {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
  return new Class(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
  return new Class(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _bigint(Class, params) {
  return new Class({
    type: "bigint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _null$1(Class, params) {
  return new Class({
    type: "null",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _properties(shape, params) {
  return new $ZodCheckProperties({
    check: "properties",
    shape,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue$1) => {
      if (typeof issue$1 === "string") {
        payload.issues.push(issue(issue$1, payload.value, ch._zod.def));
      } else {
        const _issue = issue$1;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    sharedDefsExtractedFor: void 0,
    sharedEmitDoneFor: void 0,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? void 0
  };
}
function handleUnrepresentable(schema, ctx, json, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === void 0 || result === "throw")
    throw new Error(message);
  Object.assign(json, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a2;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result);
  ctx.sharedDefsExtractedFor = void 0;
  ctx.sharedEmitDoneFor = void 0;
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    assignProps(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a2 = result.schema).default ?? (_a2.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root2 = ctx.seen.get(schema);
  if (!root2)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id2 = ctx.metadataRegistry.get(entry[0])?.id;
    if (id2) {
      const existing = idToSchema.get(id2);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id2}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id2, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id3) => id3);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id2 = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id2;
      return { defId: id2, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id2)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root2 && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref: ref2, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref2;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id2 = ctx.metadataRegistry.get(entry[0])?.id;
    if (id2) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys2 = Object.keys(option);
    if (keys2.length !== 1 || keys2[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
const FOLDABLE_KEYS = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties"]);
const UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members2) {
  const objects = [];
  for (const member of members2) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required2 = /* @__PURE__ */ new Set();
  for (const object2 of objects) {
    for (const key in object2.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === void 0)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object2.required ?? [])
      required2.add(key);
  }
  const folded = { type: "object", properties };
  if (required2.size)
    folded.required = [...required2];
  if (objects.every((object2) => object2.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object2 of objects) {
      const constraint = undeclaredConstraint(object2);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  const allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union2 = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union2[k]));
    if (Object.keys(union2).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union2);
    const branches = union2[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf;
  assignProps(json, folded);
}
function finalize(ctx, schema) {
  const root2 = ctx.seen.get(schema);
  if (!root2)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref2 = seen.ref;
    seen.ref = null;
    if (ref2) {
      flattenRef(ref2);
      const refSeen = ctx.seen.get(ref2);
      const refSchema2 = refSeen.schema;
      if (refSchema2.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema2);
      } else {
        assignProps(schema2, refSchema2);
      }
      assignProps(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref2;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema2.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref2) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = /* @__PURE__ */ new Map();
      for (const seen of ctx.seen.values()) {
        for (const json of [seen.schema, seen.def]) {
          const allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json of carriers.get(allOf) ?? [])
          foldIntersection(json);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") ;
  else ;
  if (ctx.external?.uri) {
    const id2 = ctx.external.registry.get(schema)?.id;
    if (!id2)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id2);
  }
  assignProps(result, root2.defId ? root2.schema : root2.def ?? root2.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) ;
  else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
const narrowMin = (agg, key, value) => {
  if (agg[key] === void 0 || value > agg[key])
    agg[key] = value;
};
const narrowMax = (agg, key, value) => {
  if (agg[key] === void 0 || value < agg[key])
    agg[key] = value;
};
const narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
const addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
const addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
  agg.patterns.add(pattern);
};
const intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
const setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
const minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
const maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
const formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
const contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== void 0)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== void 0)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== void 0)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== void 0)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== void 0)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== void 0) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
const formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
const exactPatterns = /* @__PURE__ */ new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
const exactPattern = (p) => exactPatterns.get(p) ?? p;
const stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time" || laxFormat) {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
const numberProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = /* @__PURE__ */ new Set();
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== void 0)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
const booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
const bigintProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "BigInt cannot be represented in JSON Schema");
};
const nullProcessor = (_schema, ctx, json, _params) => {
  if (ctx.target === "openapi-3.0") {
    json.type = "string";
    json.nullable = true;
    json.enum = [null];
  } else {
    json.type = "null";
  }
};
const neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
const unknownProcessor = (_schema, _ctx, _json, _params) => {
};
const enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
const literalProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  if (def.values.length === 0) {
    json.not = {};
    return;
  }
  const vals = [];
  for (const val of def.values) {
    if (val === void 0) {
      if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof val === "bigint") {
      if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
        return;
      vals.push(Number(val));
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) ;
  else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
const customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
const transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
const arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
const objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json.type = "object";
  json.properties = {};
  for (const key in shape) {
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
const unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
const intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
  ctx.intersections.push(allOf);
};
function stringifyKeyNames(bySchema, json, visited) {
  if (json.$ref) {
    if (visited.has(json))
      return json;
    visited.add(json);
    const def = bySchema.get(json)?.def;
    if (!def)
      return json;
    const inlined = stringifyKeyNames(bySchema, def, visited);
    return inlined === def ? json : inlined;
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches = json[keyword];
    if (!Array.isArray(branches))
      continue;
    const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
    if (mapped.some((branch, i) => branch !== branches[i]))
      json = { ...json, [keyword]: mapped };
  }
  const types = Array.isArray(json.type) ? json.type : [json.type];
  const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
  const values = json.enum ?? (json.const !== void 0 ? [json.const] : void 0);
  if (!numericType && !values?.some((v) => typeof v === "number"))
    return json;
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id: id2, ...rest } = json;
  if (rest.enum)
    rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
  else if (typeof rest.const === "number")
    rest.const = String(rest.const);
  if (!numericType)
    return rest;
  rest.type = "string";
  if (!values)
    rest.pattern = (types.includes("number") ? number$1 : integer$1).source;
  return rest;
}
const pendingRecords = /* @__PURE__ */ new WeakMap();
function rewriteKeyNames(ctx) {
  const bySchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.values()) {
    if (entry.def && !bySchema.has(entry.schema))
      bySchema.set(entry.schema, entry);
  }
  const rewrites = /* @__PURE__ */ new Map();
  for (const record2 of pendingRecords.get(ctx) ?? []) {
    const seen = ctx.seen.get(record2);
    const names = (seen?.def ?? seen?.schema)?.propertyNames;
    if (!names || names === true || rewrites.has(names))
      continue;
    const rewritten = stringifyKeyNames(bySchema, names, /* @__PURE__ */ new Set());
    if (rewritten !== names)
      rewrites.set(names, rewritten);
  }
  if (!rewrites.size)
    return;
  for (const entry of ctx.seen.values()) {
    for (const carrier of [entry.schema, entry.def]) {
      const rewritten = carrier && rewrites.get(carrier.propertyNames);
      if (rewritten)
        carrier.propertyNames = rewritten;
    }
  }
}
const recordProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const patterns = aggregateChecks(keyType).patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = processSchema(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
      let pending = pendingRecords.get(ctx);
      if (!pending) {
        pending = [];
        pendingRecords.set(ctx, pending);
        ctx.deferred.push(() => rewriteKeyNames(ctx));
      }
      pending.push(schema);
    }
    json.additionalProperties = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
  if (keyValues && !def.partial && !omittableOnInput) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues.map(String);
    }
  }
};
const nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
const nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
const UNREPRESENTABLE_DEFAULT = Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
const defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
};
const prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
};
const catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
};
const pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
const readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
const optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
const _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
const initializer = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue2) => {
    self.issues.push(issue2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues2) => {
    self.issues.push(...issues2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
const ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer, void 0, {
  Parent: Error
});
const parse$1 = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
const ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  _ensureDefaultLocale();
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  return inst;
}, {
  check(...chks) {
    const def = this.def;
    return this.clone(mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: true });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta) {
    reg.add(this, meta);
    return this;
  },
  refine(check, params) {
    return this.check(refine(check, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn) {
    return this.check(/* @__PURE__ */ _overwrite(fn));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe(this, transform(tx));
  },
  default(d) {
    return _default$1(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    const cl = this.clone();
    globalRegistry.add(cl, { description });
    return cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    const cl = this.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  },
  // Overrides core's `~standard` to add `jsonSchema`. Must stay a prototype entry: redefining it per instance demotes instances to dictionary mode.
  get "~standard"() {
    return hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  },
  parse: function _parse2(data, params) {
    return parse$1(this, data, params, { callee: _parse2 });
  },
  parseAsync: async function _parseAsync2(data, params) {
    return await parseAsync(this, data, params, { callee: _parseAsync2 });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  // `spa` is an alias: same function object as `safeParseAsync`, as before.
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    own(this, "spa", value);
  },
  validate(data, params) {
    return validate(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync$1(this, data, params);
  },
  encode: function _encode2(data, params) {
    return encode(this, data, params, { callee: _encode2 });
  },
  decode: function _decode2(data, params) {
    return decode(this, data, params, { callee: _decode2 });
  },
  encodeAsync: async function _encodeAsync2(data, params) {
    return await encodeAsync(this, data, params, { callee: _encodeAsync2 });
  },
  decodeAsync: async function _decodeAsync2(data, params) {
    return await decodeAsync(this, data, params, { callee: _decodeAsync2 });
  },
  safeEncode(data, params) {
    return safeEncode(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  // Reads through to the registry on every access, so it must not cache.
  get description() {
    return globalRegistry.get(this)?.description;
  },
  // No setter: `schema._def = x` throws, as it did when `_def` was a non-writable own property.
  get _def() {
    return this._zod.def;
  }
});
const _ZodString = /* @__PURE__ */ $constructor(
  "_ZodString",
  (inst, def) => {
    $ZodString.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json);
  },
  /* @__PURE__ */ derived({
    format: (inst) => aggregateChecks(inst).format ?? null,
    minLength: (inst) => aggregateChecks(inst).minimum ?? null,
    maxLength: (inst) => aggregateChecks(inst).maximum ?? null
  }, {
    regex(...args) {
      return this.check(/* @__PURE__ */ _regex(...args));
    },
    includes(...args) {
      return this.check(/* @__PURE__ */ _includes(...args));
    },
    startsWith(...args) {
      return this.check(/* @__PURE__ */ _startsWith(...args));
    },
    endsWith(...args) {
      return this.check(/* @__PURE__ */ _endsWith(...args));
    },
    min(...args) {
      return this.check(/* @__PURE__ */ _minLength(...args));
    },
    max(...args) {
      return this.check(/* @__PURE__ */ _maxLength(...args));
    },
    length(...args) {
      return this.check(/* @__PURE__ */ _length(...args));
    },
    nonempty(...args) {
      return this.check(/* @__PURE__ */ _minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(/* @__PURE__ */ _lowercase(params));
    },
    uppercase(params) {
      return this.check(/* @__PURE__ */ _uppercase(params));
    },
    trim() {
      return this.check(/* @__PURE__ */ _trim());
    },
    normalize(...args) {
      return this.check(/* @__PURE__ */ _normalize(...args));
    },
    toLowerCase() {
      return this.check(/* @__PURE__ */ _toLowerCase());
    },
    toUpperCase() {
      return this.check(/* @__PURE__ */ _toUpperCase());
    },
    slugify() {
      return this.check(/* @__PURE__ */ _slugify());
    }
  })
);
const ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(/* @__PURE__ */ _email(ZodEmail, params));
  },
  url(params) {
    return this.check(/* @__PURE__ */ _url(ZodURL, params));
  },
  jwt(params) {
    return this.check(/* @__PURE__ */ _jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
  },
  guid(params) {
    return this.check(/* @__PURE__ */ _guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(/* @__PURE__ */ _uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(/* @__PURE__ */ _cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(/* @__PURE__ */ _ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(/* @__PURE__ */ _base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(/* @__PURE__ */ _xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(/* @__PURE__ */ _e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(/* @__PURE__ */ _isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(/* @__PURE__ */ _isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(/* @__PURE__ */ _isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(/* @__PURE__ */ _isoDuration(ZodISODuration, params));
  }
});
function string(params) {
  return /* @__PURE__ */ _string(ZodString, params);
}
const ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
const ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function uuid(params) {
  return /* @__PURE__ */ _uuid(ZodUUID, params);
}
const ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function url(params) {
  return /* @__PURE__ */ _url(ZodURL, params);
}
const ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodNumber = /* @__PURE__ */ $constructor(
  "ZodNumber",
  (inst, def) => {
    $ZodNumber.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
    inst.isFinite = true;
  },
  /* @__PURE__ */ derived({
    minValue: (inst) => {
      const { minimum, exclusiveMinimum } = aggregateChecks(inst);
      return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
    },
    maxValue: (inst) => {
      const { maximum, exclusiveMaximum } = aggregateChecks(inst);
      return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
    },
    isInt: (inst) => {
      const { isInt, multipleOf } = aggregateChecks(inst);
      return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
    },
    format: (inst) => aggregateChecks(inst).format ?? null
  }, {
    gt(value, params) {
      return this.check(/* @__PURE__ */ _gt(value, params));
    },
    gte(value, params) {
      return this.check(/* @__PURE__ */ _gte(value, params));
    },
    min(value, params) {
      return this.check(/* @__PURE__ */ _gte(value, params));
    },
    lt(value, params) {
      return this.check(/* @__PURE__ */ _lt(value, params));
    },
    lte(value, params) {
      return this.check(/* @__PURE__ */ _lte(value, params));
    },
    max(value, params) {
      return this.check(/* @__PURE__ */ _lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(/* @__PURE__ */ _gt(0, params));
    },
    nonnegative(params) {
      return this.check(/* @__PURE__ */ _gte(0, params));
    },
    negative(params) {
      return this.check(/* @__PURE__ */ _lt(0, params));
    },
    nonpositive(params) {
      return this.check(/* @__PURE__ */ _lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(/* @__PURE__ */ _multipleOf(value, params));
    },
    step(value, params) {
      return this.check(/* @__PURE__ */ _multipleOf(value, params));
    },
    finite() {
      return this;
    }
  })
);
function number(params) {
  return /* @__PURE__ */ _number(ZodNumber, params);
}
const ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
const ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json);
});
function boolean(params) {
  return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
const ZodBigInt = /* @__PURE__ */ $constructor(
  "ZodBigInt",
  (inst, def) => {
    $ZodBigInt.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => bigintProcessor(inst, ctx, json, params);
  },
  /* @__PURE__ */ derived({
    minValue: (inst) => aggregateChecks(inst).minimum ?? null,
    maxValue: (inst) => aggregateChecks(inst).maximum ?? null,
    format: (inst) => aggregateChecks(inst).format ?? null
  }, {
    gte(value, params) {
      return this.check(/* @__PURE__ */ _gte(value, params));
    },
    min(value, params) {
      return this.check(/* @__PURE__ */ _gte(value, params));
    },
    gt(value, params) {
      return this.check(/* @__PURE__ */ _gt(value, params));
    },
    lt(value, params) {
      return this.check(/* @__PURE__ */ _lt(value, params));
    },
    lte(value, params) {
      return this.check(/* @__PURE__ */ _lte(value, params));
    },
    max(value, params) {
      return this.check(/* @__PURE__ */ _lte(value, params));
    },
    positive(params) {
      return this.check(/* @__PURE__ */ _gt(BigInt(0), params));
    },
    negative(params) {
      return this.check(/* @__PURE__ */ _lt(BigInt(0), params));
    },
    nonpositive(params) {
      return this.check(/* @__PURE__ */ _lte(BigInt(0), params));
    },
    nonnegative(params) {
      return this.check(/* @__PURE__ */ _gte(BigInt(0), params));
    },
    multipleOf(value, params) {
      return this.check(/* @__PURE__ */ _multipleOf(value, params));
    }
  })
);
function bigint(params) {
  return /* @__PURE__ */ _bigint(ZodBigInt, params);
}
const ZodNull = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
  $ZodNull.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullProcessor(inst, ctx, json);
});
function _null(params) {
  return /* @__PURE__ */ _null$1(ZodNull, params);
}
const ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor();
});
function unknown() {
  return /* @__PURE__ */ _unknown(ZodUnknown);
}
const ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json);
});
function never(params) {
  return /* @__PURE__ */ _never(ZodNever, params);
}
const ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
}, {
  min(n, params) {
    return this.check(/* @__PURE__ */ _minLength(n, params));
  },
  nonempty(params) {
    return this.check(/* @__PURE__ */ _minLength(1, params));
  },
  max(n, params) {
    return this.check(/* @__PURE__ */ _maxLength(n, params));
  },
  length(n, params) {
    return this.check(/* @__PURE__ */ _length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return /* @__PURE__ */ _array(ZodArray, element, params);
}
const ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(mergeDefs(this._zod.def, { catchall: void 0 }));
  },
  extend(incoming) {
    return extend(this, incoming);
  },
  safeExtend(incoming) {
    return safeExtend(this, incoming);
  },
  merge(other) {
    return merge(this, other);
  },
  pick(mask) {
    return pick(this, mask);
  },
  omit(mask) {
    return omit(this, mask);
  },
  partial(...args) {
    return partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return required$1(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: never(),
    ...normalizeParams(params)
  });
}
const ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
const ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...normalizeParams(params)
  });
}
const ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
const ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
const ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json);
  inst.enum = def.entries;
  inst.options = [...inst._zod.values];
  const keys2 = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys2.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys2.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
const ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
const ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue$1) => {
      if (typeof issue$1 === "string") {
        payload.issues.push(issue(issue$1, payload.value, def));
      } else {
        const _issue = issue$1;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
const ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
const ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
const ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
const ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default$1(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
const ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
const ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
const ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
  });
}
const ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
const ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
const ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return /* @__PURE__ */ _superRefine(fn, params);
}
const ZodInstanceOf = /* @__PURE__ */ $constructor("ZodInstanceOf", (inst, def) => {
  ZodCustom.init(inst, def);
}, {
  properties(shape, params) {
    return this.check(/* @__PURE__ */ _properties(shape, params));
  }
});
function _instanceof(cls, params = {}) {
  const inst = new ZodInstanceOf({
    type: "custom",
    check: "custom",
    fn: (data) => data instanceof cls,
    abort: true,
    ...normalizeParams(params)
  });
  inst._zod.bag.Class = cls;
  inst._zod.check = (payload) => {
    if (!(payload.value instanceof cls)) {
      payload.issues.push({
        code: "invalid_type",
        expected: cls.name,
        input: payload.value,
        inst,
        path: [...inst._zod.def.path ?? []]
      });
    }
  };
  return inst;
}
const PACKAGE_OWNER_FILE = ".willyou-package-owner.json";
const APP_HASH_PATTERN = /^[a-f0-9]{64}$/;
const APP_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function isPackagePath(value) {
  if (!value || value !== value.normalize("NFC") || value.length > 1024 || /[\\:\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value)) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
const nativePart = (max) => string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(max);
const path = string().refine(isPackagePath, "应用包路径无效");
const hash = string().regex(APP_HASH_PATTERN);
const operation = string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const api = number().int().positive();
object({
  schema: literal("smartdd-app-package-v1"),
  appId: nativePart(20),
  version: string().regex(version),
  displayName: string().trim().min(1).max(120),
  description: string().max(4e3),
  hostApi: object({ min: api, max: api }).strict(),
  dataApi: api,
  connectionContracts: array(object({
    providerId: string().regex(APP_ID_PATTERN),
    configApiMajor: api,
    inputSchemaPath: path,
    authModes: array(string().min(1).max(80)).min(1),
    identityContractMajor: api
  }).strict()).min(1),
  runtime: object({ id: string().regex(APP_ID_PATTERN), hash, protocolMajor: api }).strict(),
  skills: array(object({ id: nativePart(16), path, entry: path, description: string().max(2e3) }).strict()).min(1),
  tools: array(object({
    name: string().regex(/^smartdd_[a-z0-9_]+_v[1-9]\d*$/).max(128),
    contractMajor: api,
    inputSchemaPath: path,
    outputSchemaPath: path,
    permission: operation,
    annotations: object({ readOnlyHint: boolean(), destructiveHint: boolean(), idempotentHint: boolean(), openWorldHint: boolean() }).strict()
  }).strict()).min(1),
  adapter: object({ entry: path, format: literal("cjs") }).strict(),
  migrations: array(object({ id: string().regex(APP_ID_PATTERN), from: number().int().nonnegative(), to: api, file: path, checksum: hash }).strict()),
  files: array(object({ path, sha256: hash, size: number().int().nonnegative(), executable: boolean() }).strict()).min(1).max(4096),
  permissions: array(operation).min(1)
}).strict().superRefine((manifest, ctx) => {
  const issue2 = (message) => ctx.addIssue({ code: "custom", message });
  if (manifest.hostApi.min > manifest.hostApi.max) issue2("宿主API范围无效");
  const paths = /* @__PURE__ */ new Set(), folded = /* @__PURE__ */ new Set();
  for (const f of manifest.files) {
    if (["manifest.json", PACKAGE_OWNER_FILE].includes(f.path.split("/")[0].toLowerCase()) || paths.has(f.path) || folded.has(f.path.toLowerCase())) issue2("包路径重复、大小写冲突或使用保留名称");
    paths.add(f.path);
    folded.add(f.path.toLowerCase());
  }
  const required2 = [manifest.adapter.entry, ...manifest.connectionContracts.map((c) => c.inputSchemaPath), ...manifest.tools.flatMap((t) => [t.inputSchemaPath, t.outputSchemaPath]), ...manifest.skills.map((s) => s.entry), ...manifest.migrations.map((m) => m.file)];
  if (required2.some((p) => !paths.has(p))) issue2("包入口或契约未列入完整文件清单");
  for (const f of paths) for (const other of paths) if (other !== f && other.startsWith(f + "/")) issue2("文件与目录路径冲突");
  if (new Set(manifest.skills.map((s) => s.id)).size !== manifest.skills.length) issue2("Skill标识重复");
  if (manifest.skills.some((s) => !s.entry.startsWith(s.path + "/") || !s.entry.endsWith("/SKILL.md"))) issue2("Skill入口必须是本Skill目录内的SKILL.md");
  if (new Set(manifest.tools.map((t) => t.name)).size !== manifest.tools.length) issue2("工具名重复");
  if (new Set(manifest.permissions).size !== manifest.permissions.length) issue2("动作权限重复");
  const prefix = "smartdd_" + manifest.appId.replaceAll("-", "_") + "_";
  for (const t of manifest.tools) {
    if (!t.name.startsWith(prefix) || !t.name.endsWith("_v" + t.contractMajor)) issue2("工具名称与应用及主契约不一致");
    if (!manifest.permissions.includes(t.permission)) issue2("工具权限未在包声明中提供");
    if (t.permission.endsWith(".send") && (t.annotations.readOnlyHint || t.annotations.idempotentHint)) issue2("发送工具不得声明为只读或幂等");
  }
  const migrations = /* @__PURE__ */ new Set();
  for (let i = 0; i < manifest.migrations.length; i++) {
    const m = manifest.migrations[i];
    if (migrations.has(m.id) || m.to !== m.from + 1 || i && m.from !== manifest.migrations[i - 1].to) issue2("应用迁移编号或版本不连续");
    migrations.add(m.id);
    if (manifest.files.find((f) => f.path === m.file)?.sha256 !== m.checksum) issue2("迁移checksum与文件清单不一致");
  }
});
class ApplicationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ApplicationError";
  }
}
const operations = /* @__PURE__ */ new WeakMap();
function applicationPreflightFailure(error2, operationId) {
  if (error2 instanceof ApplicationError && error2.code === "UPSTREAM_RESULT_UNKNOWN") return error2;
  const failure2 = error2 instanceof ApplicationError ? new ApplicationError(error2.code, error2.message) : new ApplicationError("CAPABILITY_UNAVAILABLE", "本次应用前置检查未完成");
  operations.set(failure2, operationId);
  return failure2;
}
class BrowserError extends ApplicationError {
  constructor(code, message) {
    super(code, message);
  }
}
function staleReference() {
  return new BrowserError("BROWSER_STALE_REF", "页面引用已经失效，请重新 snapshot");
}
function helperError(message) {
  if (/timed out|timeout/i.test(message)) return new BrowserError("BROWSER_TIMEOUT", message.slice(0, 2048));
  return /unknown ref|ref not found|element not found|could not locate element|no element matches/i.test(message) ? staleReference() : new BrowserError("BROWSER_ERROR", message.slice(0, 2048));
}
class BrowserCdpProxy {
  constructor(contents, trace = () => {
  }) {
    this.contents = contents;
    this.trace = trace;
  }
  server;
  sockets;
  clients = /* @__PURE__ */ new Set();
  frameSessions = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  port = 0;
  stopped = false;
  token = node_crypto.randomBytes(32).toString("hex");
  targetId = "wy-page-" + node_crypto.randomBytes(12).toString("hex");
  ordinal = 0;
  capture;
  frameInitializer;
  frameInitializations = /* @__PURE__ */ new Map();
  get endpoint() {
    return `ws://127.0.0.1:${this.port}/${this.token}`;
  }
  get discoveryEndpoint() {
    return `http://127.0.0.1:${this.port}/${this.token}`;
  }
  get sessions() {
    return this.frameSessions;
  }
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  captureSnapshot() {
    if (this.capture) throw new BrowserError("BROWSER_ERROR", "快照读取已经在进行");
    const trees = [];
    this.capture = trees;
    return { trees, finish: () => {
      if (this.capture === trees) this.capture = void 0;
    } };
  }
  initializeFrames(work) {
    this.frameInitializer = work;
  }
  async frameReady(sessionId) {
    if (sessionId) await this.frameInitializations.get(sessionId);
  }
  send = async (method, params = {}, sessionId) => {
    if (this.stopped || this.contents.isDestroyed()) throw new BrowserError("BROWSER_TAB_CLOSED", "网页已经关闭");
    if (sessionId && !this.frameSessions.has(sessionId)) throw new BrowserError("BROWSER_TAB_CHANGED", "网页框架会话已经失效");
    let timer;
    try {
      return await Promise.race([
        sessionId ? this.contents.debugger.sendCommand(method, params, sessionId) : this.contents.debugger.sendCommand(method, params),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new BrowserError("BROWSER_TIMEOUT", `CDP ${method} 超时`)), 1e4);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  trusted(request) {
    return request.socket.remoteAddress === "127.0.0.1" && request.headers.host === `127.0.0.1:${this.port}` && !request.headers.origin && !request.headers["sec-fetch-site"];
  }
  target() {
    return { targetId: this.targetId, type: "page", title: this.contents.getTitle(), url: this.contents.getURL(), attached: true, canAccessOpener: false, browserContextId: "wy-page-context" };
  }
  emit(client, value) {
    if (client.socket.readyState === ws.WebSocket.OPEN) client.socket.send(JSON.stringify(value));
  }
  message = (_event, method, params, sessionId) => {
    if (method === "Target.attachedToTarget") {
      const target = params.targetInfo, child = params.sessionId;
      if (typeof child !== "string") return;
      if (target?.type !== "iframe") {
        if (params.waitingForDebugger) void this.contents.debugger.sendCommand("Runtime.runIfWaitingForDebugger", {}, child).catch(() => {
        });
        return;
      }
      this.frameSessions.set(child, target);
      if (this.frameInitializer) {
        const prepare = this.frameInitializer(child);
        this.frameInitializations.set(child, prepare);
        void prepare.then(() => this.send("Runtime.runIfWaitingForDebugger", {}, child), (error2) => {
          this.trace({ kind: "frame-initialization-error", message: String(error2) });
          return this.send("Runtime.runIfWaitingForDebugger", {}, child);
        }).catch(() => {
        });
      }
    }
    if (method === "Target.detachedFromTarget" && typeof params.sessionId === "string") {
      this.frameSessions.delete(params.sessionId);
      this.frameInitializations.delete(params.sessionId);
    }
    if (sessionId && !this.frameSessions.has(sessionId)) return;
    const event = { method, params, ...sessionId ? { sessionId } : {} };
    for (const listener of this.listeners) listener(event);
    for (const client of this.clients) this.emit(client, { method, params, sessionId: sessionId || client.primary || "" });
  };
  detached = () => {
    if (!this.stopped) void this.stop();
  };
  async start() {
    if (this.server) return this.endpoint;
    if (this.stopped) throw new BrowserError("BROWSER_UNAVAILABLE", "CDP 代理已关闭");
    if (this.contents.debugger.isAttached()) throw new BrowserError("BROWSER_UNAVAILABLE", "网页调试器已有其他持有者");
    this.contents.debugger.attach("1.3");
    this.contents.debugger.on("message", this.message);
    this.contents.debugger.on("detach", this.detached);
    try {
      await this.send("Page.enable");
      await this.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: Boolean(this.frameInitializer), flatten: true });
      this.server = node_http.createServer((request, response2) => {
        this.trace({ kind: "http", host: request.headers.host, origin: request.headers.origin ?? null, route: request.url?.endsWith("/json/version") ? "version" : "other", allowed: this.trusted(request) });
        if (!this.trusted(request)) {
          response2.writeHead(403).end();
          return;
        }
        const path2 = request.url, prefix = "/" + this.token;
        response2.setHeader("Content-Type", "application/json");
        response2.setHeader("Cache-Control", "no-store");
        if (path2 === prefix + "/json/version") response2.end(JSON.stringify({ Browser: `Chrome/${process.versions.chrome}`, "Protocol-Version": "1.3", webSocketDebuggerUrl: this.endpoint }));
        else if (path2 === prefix + "/json/list" || path2 === prefix + "/json") response2.end(JSON.stringify([{ ...this.target(), id: this.targetId, webSocketDebuggerUrl: this.endpoint }]));
        else response2.writeHead(404).end();
      });
      this.sockets = new ws.WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
      this.server.on("upgrade", (request, socket, head) => {
        this.trace({ kind: "upgrade", host: request.headers.host, origin: request.headers.origin ?? null, allowed: this.trusted(request) && request.url === "/" + this.token });
        if (!this.trusted(request) || request.url !== "/" + this.token) {
          socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          return;
        }
        this.sockets.handleUpgrade(request, socket, head, (ws2) => this.sockets.emit("connection", ws2));
      });
      this.sockets.on("connection", (socket) => {
        this.trace({ kind: "connected" });
        const client = { socket, pageSessions: /* @__PURE__ */ new Set(), browserSessions: /* @__PURE__ */ new Set() };
        this.clients.add(client);
        socket.on("error", (error2) => {
          this.trace({ kind: "socket-error", message: error2.message });
        });
        socket.on("message", (data) => {
          void this.handle(client, data.toString());
        });
        socket.once("close", (code) => {
          this.trace({ kind: "socket-close", code });
          this.clients.delete(client);
        });
      });
      await new Promise((resolve, reject) => {
        this.server.once("error", reject);
        this.server.listen(0, "127.0.0.1", () => {
          const address = this.server.address();
          if (!address || typeof address === "string") {
            reject(new Error("CDP bind failed"));
            return;
          }
          this.port = address.port;
          this.server.removeListener("error", reject);
          resolve();
        });
      });
      return this.endpoint;
    } catch (error2) {
      await this.stop();
      throw error2;
    }
  }
  async handle(client, raw2) {
    let msg;
    try {
      msg = JSON.parse(raw2);
      if (!Number.isSafeInteger(msg.id) || typeof msg.method !== "string" || msg.params && (typeof msg.params !== "object" || Array.isArray(msg.params))) {
        this.trace({ kind: "invalid-envelope", idType: typeof msg.id, methodType: typeof msg.method, paramsType: typeof msg.params, keys: Object.keys(msg) });
        return;
      }
    } catch {
      this.trace({ kind: "invalid-json", length: raw2.length });
      return;
    }
    const { id: id2, method, sessionId } = msg, params = msg.params ?? {};
    this.trace({ kind: "command", method, sessionId: sessionId ?? null });
    const reply = (result) => this.emit(client, { id: id2, result, ...sessionId ? { sessionId } : {} });
    const denied = () => {
      throw new BrowserError("BROWSER_UNAVAILABLE", "CDP request is outside this page");
    };
    try {
      if (sessionId && !client.pageSessions.has(sessionId) && !client.browserSessions.has(sessionId) && !this.frameSessions.has(sessionId)) denied();
      if (method === "Browser.getVersion") {
        reply({ protocolVersion: "1.3", product: `Chrome/${process.versions.chrome}`, revision: "", userAgent: "", jsVersion: "" });
        return;
      }
      if (method.startsWith("Browser.")) denied();
      if (method === "Target.getTargets") {
        reply({ targetInfos: [this.target()] });
        return;
      }
      if (method === "Target.getTargetInfo") {
        if (params.targetId !== void 0 && params.targetId !== this.targetId) denied();
        reply({ targetInfo: this.target() });
        return;
      }
      if (method === "Target.setDiscoverTargets") {
        denied();
      }
      if (method === "Target.attachToBrowserTarget") {
        const value = "wy-browser-" + ++this.ordinal;
        client.browserSessions.add(value);
        reply({ sessionId: value });
        return;
      }
      if (method === "Target.attachToTarget") {
        if (params.targetId !== this.targetId) denied();
        const value = "wy-session-" + ++this.ordinal;
        client.pageSessions.add(value);
        client.primary ??= value;
        reply({ sessionId: value });
        return;
      }
      if (method === "Target.detachFromTarget") {
        const value = String(params.sessionId);
        if (!client.pageSessions.delete(value) && !client.browserSessions.delete(value)) denied();
        if (value === client.primary) client.primary = [...client.pageSessions][0];
        reply({});
        return;
      }
      if (method === "Target.setAutoAttach") {
        await this.send(method, { ...params, autoAttach: true, flatten: true, waitForDebuggerOnStart: Boolean(this.frameInitializer) }, this.frameSessions.has(sessionId ?? "") ? sessionId : void 0);
        reply({});
        for (const [child, targetInfo] of this.frameSessions) this.emit(client, { method: "Target.attachedToTarget", params: { sessionId: child, targetInfo, waitingForDebugger: false }, ...sessionId ? { sessionId } : {} });
        return;
      }
      if (method.startsWith("Target.")) denied();
      if (method === "Page.bringToFront") {
        reply({});
        return;
      }
      if (method.startsWith("Storage.") || method.startsWith("SystemInfo.") || method.startsWith("Tethering.")) denied();
      const effectiveSession = sessionId && this.frameSessions.has(sessionId) ? sessionId : void 0;
      await this.frameReady(effectiveSession);
      let captured;
      if (this.capture && method === "Accessibility.getFullAXTree") {
        captured = { sessionId: effectiveSession, frameId: typeof params.frameId === "string" ? params.frameId : void 0, nodes: [] };
        this.capture.push(captured);
      }
      const result = await this.send(method, params, effectiveSession);
      if (captured && Array.isArray(result.nodes)) captured.nodes = result.nodes;
      reply(result);
    } catch (error2) {
      this.emit(client, { id: id2, error: { code: -32e3, message: error2 instanceof Error ? error2.message : String(error2) }, ...sessionId ? { sessionId } : {} });
    }
  }
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.contents.debugger.removeListener("message", this.message);
    this.contents.debugger.removeListener("detach", this.detached);
    for (const { socket } of this.clients) socket.terminate();
    this.clients.clear();
    this.frameSessions.clear();
    this.frameInitializations.clear();
    this.listeners.clear();
    this.sockets?.close();
    if (this.server) await new Promise((resolve) => this.server.close(() => resolve()));
    if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) this.contents.debugger.detach();
  }
}
const browserDigest = (value) => node_crypto.createHash("sha256").update(value).digest("hex");
class BrowserArtifacts {
  constructor(root2) {
    this.root = root2;
  }
  tail = Promise.resolve();
  serialize(work) {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {
    });
    return result;
  }
  async checkRoot() {
    try {
      const stat = await promises.lstat(this.root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApplicationError("SCOPE_DENIED", "浏览器文件根目录必须是实际目录");
      return true;
    } catch (error2) {
      if (error2.code === "ENOENT") return false;
      throw error2;
    }
  }
  async write(taskId, command, extension, bytes) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskId) || !/^[a-z][a-z-]{0,40}$/.test(command))
      throw new ApplicationError("INVALID_INPUT", "浏览器文件归属或命令无效");
    return this.serialize(async () => {
      await this.checkRoot();
      await promises.mkdir(this.root, { recursive: true, mode: 448 });
      const base = await promises.realpath(this.root), directory = node_path.join(base, taskId);
      await promises.mkdir(directory, { recursive: true, mode: 448 });
      if (await promises.realpath(directory) !== directory) throw new ApplicationError("SCOPE_DENIED", "浏览器文件目录不能是符号链接");
      const name = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${command}-${node_crypto.randomBytes(3).toString("hex")}.${extension}`;
      const path2 = node_path.join(directory, name), file = await promises.open(path2, "wx", 384);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      return { path: path2, bytes: bytes.byteLength, sha256: browserDigest(bytes) };
    });
  }
  usage() {
    return this.serialize(async () => {
      if (!await this.checkRoot()) return 0;
      const size = async (path2) => {
        const stat = await promises.lstat(path2);
        if (stat.isSymbolicLink()) return 0;
        if (stat.isFile()) return stat.size;
        if (!stat.isDirectory()) return 0;
        let bytes = 0;
        for (const name of await promises.readdir(path2)) bytes += await size(node_path.join(path2, name));
        return bytes;
      };
      return size(this.root);
    });
  }
  clear() {
    return this.serialize(async () => {
      if (!await this.checkRoot()) return;
      for (const name of await promises.readdir(this.root)) await promises.rm(node_path.join(this.root, name), { recursive: true, force: true });
    });
  }
  async result(taskId, command, data) {
    const bytes = Buffer.from(JSON.stringify(data));
    if (bytes.length <= 512 * 1024) return data;
    const file = await this.write(taskId, command, "json", bytes);
    let preview = bytes.subarray(0, 4096).toString("utf8").replace(/\uFFFD$/, "");
    while (Buffer.byteLength(preview) > 4096) preview = preview.slice(0, -1);
    return { file, truncatedPreview: preview };
  }
}
class BrowserInputInterrupted extends BrowserError {
  constructor() {
    super("BROWSER_ERROR", "输入会话已经中断；已确认部分保留，不能自动继续或重发");
  }
}
class BrowserHelper {
  constructor(options, resetReferences) {
    this.options = options;
    this.resetReferences = resetReferences;
  }
  active;
  initialized;
  timeouts = 0;
  daemon;
  closing;
  revision = 0;
  lastCleanup;
  get cleanup() {
    return this.lastCleanup;
  }
  get sessionRevision() {
    return this.revision;
  }
  async prepare() {
    this.initialized ??= (async () => {
      if (browserDigest(await promises.readFile(this.options.executable)) !== this.options.sha256)
        throw new BrowserError("BROWSER_UNAVAILABLE", "agent-browser 文件摘要不符");
      for (const path2 of [this.options.home, this.socketDirectory(), node_path.join(this.options.home, "tmp")]) await promises.mkdir(path2, { recursive: true, mode: 448 });
    })();
    await this.initialized;
  }
  socketDirectory() {
    return this.options.sockets ?? node_path.join(this.options.home, "sockets");
  }
  async observeDaemon() {
    if (!this.options.processes) return;
    try {
      const pid = Number(await promises.readFile(node_path.join(this.socketDirectory(), this.options.session + ".pid"), "utf8"));
      if (Number.isSafeInteger(pid) && pid > 1 && (!this.daemon || this.daemon.pid !== pid)) this.daemon = this.options.processes.read(pid) ?? void 0;
    } catch {
    }
  }
  environment() {
    return {
      PATH: process.env.PATH,
      HOME: this.options.home,
      TMPDIR: node_path.join(this.options.home, "tmp"),
      XDG_CONFIG_HOME: node_path.join(this.options.home, "config"),
      XDG_CACHE_HOME: node_path.join(this.options.home, "cache"),
      AGENT_BROWSER_SOCKET_DIR: this.socketDirectory(),
      AGENT_BROWSER_IDLE_TIMEOUT_MS: "600000",
      // The explicit dialog accept/dismiss contract includes alerts. The pinned
      // kernel otherwise consumes alert/beforeunload before the caller can act.
      AGENT_BROWSER_NO_AUTO_DIALOG: "1"
    };
  }
  async checkSession() {
    await this.closing;
    await this.prepare();
    if (!this.daemon || !this.options.processes) return false;
    const state2 = this.options.processes.state(this.daemon);
    if (state2 === "unknown") throw new BrowserError("BROWSER_UNAVAILABLE", "无法核对本页 agent-browser 进程身份");
    if (state2 === "running") return false;
    await this.close();
    return true;
  }
  /** Called before host-only actions too: fill/CDP fallback must not bypass helper lifecycle checks. */
  async ensureSession() {
    if (await this.checkSession()) await this.command(["get", "url"]);
  }
  async assertInputSession(revision) {
    await this.checkSession();
    if (revision !== this.revision) throw new BrowserInputInterrupted();
  }
  invalidate() {
    this.revision++;
    this.resetReferences();
  }
  async timeoutFailure(timeout, message) {
    this.timeouts++;
    if (this.timeouts >= 3) {
      await this.close();
      this.timeouts = 0;
      await this.command(["get", "url"]).catch(() => {
      });
    }
    throw new BrowserError("BROWSER_TIMEOUT", message ?? `浏览器命令等待 ${timeout}ms 后超时`);
  }
  async command(command, options = {}) {
    if (command[0] === "clipboard" && command[1] === "write" && Buffer.byteLength(command.slice(2).join(" "), "utf8") > 16 * 1024 * 1024)
      throw new ApplicationError("INVALID_INPUT", "剪贴板文本超过16MiB宿主上限");
    await this.checkSession();
    if (options.sessionRevision !== void 0 && options.sessionRevision !== this.revision) throw new BrowserInputInterrupted();
    if (options.signal?.aborted) {
      await this.closing;
      throw options.signal.reason ?? new BrowserError("BROWSER_ERROR", "操作已取消");
    }
    const timeout = options.timeout ?? 9e4;
    const output = await new Promise((resolve) => {
      let timedOut = false;
      const child = node_child_process.execFile(
        this.options.executable,
        ["--session", this.options.session, "--cdp", this.options.endpoint, "batch", "--json"],
        { env: this.environment(), maxBuffer: 16 * 1024 * 1024 },
        (error2, stdout) => {
          clearTimeout(timer);
          clearTimeout(hardKill);
          clearInterval(observe);
          options.signal?.removeEventListener("abort", cancel);
          if (this.active === child) this.active = void 0;
          resolve({ stdout, error: error2, timedOut });
        }
      );
      this.active = child;
      let hardKill;
      const observe = setInterval(() => {
        void this.observeDaemon();
      }, 100);
      const cancel = () => {
        child.kill("SIGTERM");
        hardKill ??= setTimeout(() => child.kill("SIGKILL"), 250);
        void this.close();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        cancel();
      }, timeout);
      options.signal?.addEventListener("abort", cancel, { once: true });
      child.stdin.on("error", () => {
      });
      child.stdin.end(JSON.stringify([command]), () => options.dispatched?.());
    });
    await this.observeDaemon();
    if (output.timedOut) {
      await this.closing;
      return this.timeoutFailure(timeout);
    }
    if (options.signal?.aborted) {
      await this.closing;
      throw options.signal.reason ?? new BrowserError("BROWSER_ERROR", "操作已取消");
    }
    let records;
    try {
      records = JSON.parse(output.stdout);
    } catch {
      this.invalidate();
      throw new BrowserError("BROWSER_ERROR", "agent-browser 没有返回完整结果；操作可能已经生效，请查询回执");
    }
    if (!Array.isArray(records) || records.length !== 1 || records[0].success !== true) {
      const message = String(records?.[0]?.error ?? "agent-browser 执行失败，未返回有效结果").replaceAll(this.options.endpoint, "<page-cdp>");
      const error2 = command[0] === "find" && !/timed out|timeout/i.test(message) ? new BrowserError("BROWSER_ERROR", message.slice(0, 2048)) : helperError(message);
      if (error2.code === "BROWSER_TIMEOUT") return this.timeoutFailure(timeout, error2.message);
      if (/failed to read|failed to send|invalid response:/i.test(message)) await this.close();
      throw error2;
    }
    this.timeouts = 0;
    return records[0].result ?? records[0].data ?? null;
  }
  async close() {
    if (this.closing) return this.closing;
    this.closing = this.closeOwned().finally(() => {
      this.closing = void 0;
    });
    return this.closing;
  }
  async closeOwned() {
    this.invalidate();
    this.active?.kill("SIGTERM");
    if (!this.initialized) return;
    await this.observeDaemon();
    const active = this.active, hardKill = setTimeout(() => active?.kill("SIGKILL"), 250);
    const stopDaemon = () => {
      if (this.daemon && this.options.processes?.state(this.daemon) === "running") {
        try {
          process.kill(this.daemon.pid, "SIGKILL");
        } catch (error2) {
          if (error2.code !== "ESRCH") throw error2;
        }
      }
    };
    const daemonDeadline = setTimeout(stopDaemon, 3250);
    let hasDaemonRecord = Boolean(this.daemon);
    if (!hasDaemonRecord) try {
      const pid2 = Number(await promises.readFile(node_path.join(this.socketDirectory(), this.options.session + ".pid"), "utf8"));
      hasDaemonRecord = Number.isSafeInteger(pid2) && pid2 > 1;
    } catch {
    }
    const alreadyStopped = this.daemon && this.options.processes?.state(this.daemon) === "stopped";
    if (hasDaemonRecord && !alreadyStopped) {
      await new Promise((resolve) => node_child_process.execFile(
        this.options.executable,
        ["--session", this.options.session, "close"],
        { env: this.environment(), timeout: 3e3, killSignal: "SIGKILL", maxBuffer: 65536 },
        () => resolve()
      ));
    }
    clearTimeout(hardKill);
    clearTimeout(daemonDeadline);
    stopDaemon();
    let pid = null;
    try {
      const value = Number(await promises.readFile(node_path.join(this.socketDirectory(), this.options.session + ".pid"), "utf8"));
      if (Number.isSafeInteger(value) && value > 1) pid = value;
    } catch {
    }
    let daemonState = this.daemon && this.options.processes ? this.options.processes.state(this.daemon) : pid ? "unknown" : "absent";
    if (pid && daemonState === "unknown") try {
      process.kill(pid, 0);
    } catch (error2) {
      if (error2.code === "ESRCH") daemonState = "stopped";
    }
    let socketFilesRemoved = false;
    if (daemonState === "stopped" || daemonState === "absent") {
      for (const suffix of [".sock", ".pid", ".stream"]) await promises.rm(node_path.join(this.socketDirectory(), this.options.session + suffix), { force: true });
      socketFilesRemoved = true;
    }
    this.lastCleanup = { daemonPid: pid ?? this.daemon?.pid ?? null, daemonState, clientStopped: !active || active.exitCode !== null || active.signalCode !== null, socketFilesRemoved };
    this.daemon = void 0;
  }
}
const BROWSER_GUARD_WORLD = "willyou-browser-identity-v1";
const BROWSER_GUARD_SOURCE = String.raw`(() => {
  if (globalThis.__wyBrowserGuard) return;
  let targets = [], previousFocus = null, blocked = [], accepted = [];
  const kinds = ['pointerdown','mousedown','pointerup','mouseup','click','dblclick','keydown','keyup','keypress','beforeinput','input','change','focus','focusin','pointermove','mousemove','pointerover','mouseover','pointerenter','mouseenter','dragstart','drag','dragenter','dragleave','dragover','drop','dragend'];
  function matches(e) {
    if (!targets.length || !targets.every(node => node.isConnected)) return false;
    // A click may first reposition the virtual pointer outside its destination.
    // Once the retained node is gone, even those preparatory events are blocked.
    if (/^(pointer|mouse)(move|over|enter)$/.test(e.type)) return true;
    // A drag crosses intermediate nodes. Transit events may pass while both
    // retained endpoints are connected; activation/drop still require the endpoint.
    if (targets.length > 1 && /^(dragenter|dragleave|dragover)$/.test(e.type)) return true;
    if ((e.type === 'focus' || e.type === 'focusin') && (e.target === window || e.target === document)) return true;
    // Clicking away from an edited input commits its pending change on blur.
    // Permit only that same retained previous-focus node while the action target remains connected.
    if (e.type === 'change' && previousFocus && previousFocus.isConnected && e.target === previousFocus) return true;
    const path = e.composedPath();
    const candidates=targets.length>1&&(e.type==='drop')?[targets[targets.length-1]]:targets.length>1&&/^(dragstart|pointerdown|mousedown)$/.test(e.type)?[targets[0]]:targets;
    return candidates.some(target => {
      if (path.includes(target)) return true;
      // Closed shadow roots retarget events at their host. Inspect the held root.
      const root = target.getRootNode();
      if (root && root !== document) {
        let actual = null;
        if (typeof e.clientX === 'number' && root.elementFromPoint) actual = root.elementFromPoint(e.clientX, e.clientY);
        else actual = root.activeElement;
        if (actual && (actual === target || target.contains(actual))) return true;
      }
      return /^(pointer|mouse)(over|enter)$/.test(e.type) && e.target instanceof Node && e.target.contains(target);
    });
  }
  function guard(e) {
    if (!targets.length) return;
    if (matches(e)) { accepted.push(e.type); return; }
    e.preventDefault(); e.stopImmediatePropagation(); blocked.push(e.type);
  }
  for (const kind of kinds) window.addEventListener(kind, guard, true);
  Object.defineProperty(globalThis, '__wyBrowserGuard', {value: {
    arm(node, append = false) { if (!node || !node.isConnected) return false; if (!append || !targets.length) { targets = []; previousFocus = document.activeElement; blocked = []; accepted = []; } targets.push(node); return true; },
    valid() { return !!targets.length && targets.every(node => node.isConnected); },
    state() { return {blocked:blocked.slice(), accepted:accepted.slice(), connected:this.valid()}; },
    disarm() { const result = this.state(); targets = []; previousFocus = null; blocked = []; accepted = []; return result; }
  }});
})()`;
const browserAXRoleKey = (role, name) => JSON.stringify([role, name]);
const groupKey = (node2) => JSON.stringify([node2.sessionId ?? "", node2.frameId, node2.role, node2.name]);
function indexBrowserAXTrees(trees) {
  const ordered = [], groups = /* @__PURE__ */ new Map(), identities = /* @__PURE__ */ new Set();
  for (const tree of trees) {
    const fallback = tree.frameId ?? tree.nodes.find((node2) => node2.frameId)?.frameId;
    if (!fallback) continue;
    const byId = new Map(tree.nodes.map((node2) => [node2.nodeId, node2])), children = new Set(tree.nodes.flatMap((node2) => node2.childIds ?? []));
    const visited = /* @__PURE__ */ new Set();
    const walk2 = (root2) => {
      const stack = [{ node: root2, frameId: fallback }];
      while (stack.length) {
        const item = stack.pop();
        if (!item || visited.has(item.node.nodeId)) continue;
        const node2 = item.node, frameId = node2.frameId ?? item.frameId;
        visited.add(node2.nodeId);
        for (const id2 of [...node2.childIds ?? []].reverse()) {
          const child = byId.get(id2);
          if (child) stack.push({ node: child, frameId });
        }
        if (node2.ignored || !node2.backendDOMNodeId || !node2.role?.value) continue;
        const identity = JSON.stringify([tree.sessionId ?? "", frameId, node2.backendDOMNodeId]);
        if (identities.has(identity)) continue;
        identities.add(identity);
        const partial2 = { backendNodeId: node2.backendDOMNodeId, frameId, sessionId: tree.sessionId, role: node2.role.value, name: node2.name?.value ?? "" };
        const key = groupKey(partial2), group = groups.get(key) ?? [];
        const entry = { ...partial2, ordinal: group.length };
        group.push(entry);
        groups.set(key, group);
        ordered.push(entry);
      }
    };
    for (const node2 of tree.nodes) if (!children.has(node2.nodeId)) walk2(node2);
    for (const node2 of tree.nodes) walk2(node2);
  }
  return { ordered, groups };
}
function browserAXIdentityMatches(index2, expected) {
  return index2.groups.get(groupKey(expected))?.[expected.ordinal]?.backendNodeId === expected.backendNodeId;
}
const helperSnapshotSchema = object({
  snapshot: string(),
  refs: record(string().regex(/^e\d+$/), object({ role: string(), name: string().default("") })),
  origin: string().optional()
});
class BrowserReferences {
  constructor(proxy, pageShort) {
    this.proxy = proxy;
    this.pageShort = pageShort;
    proxy.initializeFrames((session) => this.initialize(session));
    proxy.onEvent((event) => {
      if (event.method === "Page.frameNavigated") this.invalidate();
      if (event.method === "Runtime.executionContextCreated") {
        const context = event.params.context;
        if (context?.name === BROWSER_GUARD_WORLD && context.auxData?.frameId) this.worlds.set((event.sessionId ?? "") + "\0" + context.auxData.frameId, context.id);
      }
      if (event.method === "Runtime.executionContextsCleared") {
        for (const key of this.worlds.keys()) if (key.startsWith((event.sessionId ?? "") + "\0")) this.worlds.delete(key);
      }
      if (event.method === "Runtime.executionContextDestroyed") {
        for (const [key, id2] of this.worlds) if (id2 === event.params.executionContextId && key.startsWith((event.sessionId ?? "") + "\0")) this.worlds.delete(key);
      }
    });
  }
  generation = 0;
  refs = /* @__PURE__ */ new Map();
  worlds = /* @__PURE__ */ new Map();
  invalidate() {
    this.generation++;
    this.refs.clear();
  }
  async initialize(sessionId) {
    await this.proxy.send("Page.enable", {}, sessionId);
    await this.proxy.send("Runtime.enable", {}, sessionId);
    await this.proxy.send("Page.addScriptToEvaluateOnNewDocument", { source: BROWSER_GUARD_SOURCE, worldName: BROWSER_GUARD_WORLD, runImmediately: true }, sessionId);
  }
  async context(frameId, sessionId) {
    await this.proxy.frameReady(sessionId);
    const context = this.worlds.get((sessionId ?? "") + "\0" + frameId);
    if (context === void 0) throw new BrowserError("BROWSER_UNAVAILABLE", "页面的预先动作守卫尚未就绪");
    return context;
  }
  frameGone(error2) {
    return error2 instanceof BrowserError && error2.code === "BROWSER_TAB_CHANGED" || error2 instanceof Error && /no frame|cannot find frame|frame.*(?:not found|detached)|session.*(?:not found|closed)/i.test(error2.message);
  }
  async readIdentityTrees() {
    const roots = [];
    for (const sessionId of [void 0, ...this.proxy.sessions.keys()]) {
      try {
        await this.proxy.frameReady(sessionId);
        const value = await this.proxy.send("Page.getFrameTree", {}, sessionId);
        roots.push({ sessionId, tree: value.frameTree });
      } catch (error2) {
        if (!sessionId || !this.frameGone(error2)) throw error2;
      }
    }
    const owners = new Map(roots.map((root2) => [root2.tree.frame.id, root2.sessionId]));
    const trees = [], seen = /* @__PURE__ */ new Set();
    for (const root2 of roots) {
      await this.proxy.send("Accessibility.enable", {}, root2.sessionId);
      const frames = [root2.tree];
      while (frames.length) {
        const frame = frames.shift();
        if (!frame) continue;
        if (owners.has(frame.frame.id) && owners.get(frame.frame.id) !== root2.sessionId) continue;
        frames.push(...frame.childFrames ?? []);
        const key = JSON.stringify([root2.sessionId ?? "", frame.frame.id]);
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const value = await this.proxy.send("Accessibility.getFullAXTree", { frameId: frame.frame.id }, root2.sessionId);
          trees.push({ sessionId: root2.sessionId, frameId: frame.frame.id, nodes: value.nodes });
        } catch (error2) {
          if (!this.frameGone(error2)) throw error2;
        }
      }
    }
    return trees;
  }
  /** T1 + the exact helper responses + T2. Matching only the outside samples misses A→B→A. */
  async snapshot(helper, signal) {
    this.invalidate();
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw signal.reason ?? new BrowserError("BROWSER_ERROR", "快照已取消");
      const epoch = this.generation, before = indexBrowserAXTrees(await this.readIdentityTrees());
      const capture = this.proxy.captureSnapshot();
      let raw2;
      try {
        raw2 = await helper.command(["snapshot"], { signal });
      } finally {
        capture.finish();
      }
      const parsed = helperSnapshotSchema.safeParse(raw2);
      if (!parsed.success || !capture.trees.length)
        throw new BrowserError("BROWSER_UNAVAILABLE", "固定helper未提供可核对的快照及原始无障碍树");
      const trees = [];
      for (const tree of capture.trees) {
        const frameId = tree.frameId ?? tree.nodes.find((node2) => node2.frameId)?.frameId ?? (await this.proxy.send("Page.getFrameTree", {}, tree.sessionId)).frameTree.frame.id;
        trees.push({ ...tree, frameId });
      }
      const captured = indexBrowserAXTrees(trees), after = indexBrowserAXTrees(await this.readIdentityTrees());
      const candidates = /* @__PURE__ */ new Map();
      for (const node2 of captured.ordered) {
        const key = browserAXRoleKey(node2.role, node2.name), entries = candidates.get(key) ?? [];
        entries.push(node2);
        candidates.set(key, entries);
      }
      const counts = /* @__PURE__ */ new Map(), mapping = /* @__PURE__ */ new Map();
      const refs = [], bindings = /* @__PURE__ */ new Map();
      for (const [internal, metadata] of Object.entries(parsed.data.refs).sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))) {
        const key = browserAXRoleKey(metadata.role, metadata.name), ordinal = counts.get(key) ?? 0;
        counts.set(key, ordinal + 1);
        const node2 = candidates.get(key)?.[ordinal], external = "@" + this.pageShort + "s" + epoch + internal;
        const stable = Boolean(node2 && epoch === this.generation && browserAXIdentityMatches(before, node2) && browserAXIdentityMatches(after, node2));
        mapping.set(internal, external);
        if (node2 && stable) bindings.set(external, node2);
        refs.push({ ref: external, role: metadata.role, name: metadata.name, available: stable });
      }
      if (attempt < 2 && refs.some((ref2) => !ref2.available)) continue;
      this.refs = bindings;
      return { origin: parsed.data.origin, snapshot: parsed.data.snapshot.replace(/ref=(e\d+)/g, (_match, id2) => "ref=" + (mapping.get(id2) ?? id2)), refs };
    }
  }
  async arm(ref2, options = {}) {
    const append = options.append === true, locator = options.locator !== false;
    const node2 = this.refs.get(ref2);
    if (!node2) throw staleReference();
    try {
      const current = await this.proxy.send("Accessibility.getFullAXTree", { frameId: node2.frameId }, node2.sessionId);
      if (!browserAXIdentityMatches(indexBrowserAXTrees([{ sessionId: node2.sessionId, frameId: node2.frameId, nodes: current.nodes }]), node2)) throw staleReference();
    } catch (error2) {
      if (this.frameGone(error2)) throw staleReference();
      throw error2;
    }
    if (this.refs.get(ref2) !== node2) throw staleReference();
    const contextId = await this.context(node2.frameId, node2.sessionId);
    let resolved;
    try {
      resolved = await this.proxy.send("DOM.resolveNode", { backendNodeId: node2.backendNodeId, executionContextId: contextId }, node2.sessionId);
    } catch (error2) {
      if (this.frameGone(error2) || error2 instanceof Error && /could not find node|no node|node.*(?:not found|detached)/i.test(error2.message)) throw staleReference();
      throw error2;
    }
    const objectId = resolved.object.objectId;
    if (!objectId) throw staleReference();
    const armed = await this.proxy.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: "function(append){return globalThis.__wyBrowserGuard?.arm(this,append) ?? false}",
      arguments: [{ value: append }],
      returnByValue: true
    }, node2.sessionId);
    if (armed.result.value !== true) {
      await this.proxy.send("Runtime.releaseObject", { objectId }, node2.sessionId).catch(() => {
      });
      throw staleReference();
    }
    const nonce = node_crypto.randomBytes(16).toString("hex");
    let hostClick;
    try {
      const location = await this.proxy.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: "function(){return this.getRootNode()!==this.ownerDocument||window!==window.top}",
        returnByValue: true
      }, node2.sessionId);
      hostClick = location.result.value === true;
      if (locator) await this.proxy.send("Runtime.callFunctionOn", { objectId, functionDeclaration: 'function(value){this.setAttribute("data-willyou-ref",value)}', arguments: [{ value: nonce }] }, node2.sessionId);
    } catch (error2) {
      await this.disarm(node2, contextId, objectId, false, locator).catch(() => {
      });
      throw error2;
    }
    const pointer = async (kind, options2 = {}) => {
      const check = () => {
        if (options2.signal?.aborted) throw options2.signal.reason ?? new BrowserError("BROWSER_ERROR", "点击已取消");
      };
      const connected = async () => (await this.proxy.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: "function(){return this.isConnected&&globalThis.__wyBrowserGuard.valid()}",
        returnByValue: true
      }, node2.sessionId)).result.value === true;
      check();
      if (!await connected()) {
        options2.notStarted?.();
        throw staleReference();
      }
      options2.dispatched?.();
      await this.proxy.send("DOM.scrollIntoViewIfNeeded", { objectId }, node2.sessionId);
      const geometry = await this.proxy.send("DOM.getContentQuads", { objectId }, node2.sessionId);
      const quad = geometry.quads.find((value) => value.length === 8 && value.every(Number.isFinite));
      if (!quad) throw new BrowserError("BROWSER_ERROR", "目标没有可点击的布局区域");
      const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      const hit = await this.proxy.send("DOM.getNodeForLocation", { x: Math.floor(x), y: Math.floor(y), includeUserAgentShadowDOM: true }, node2.sessionId);
      if (hit.frameId !== node2.frameId) throw new BrowserError("BROWSER_ERROR", "点击位置被其他页面框架遮挡");
      const hitObject = await this.proxy.send("DOM.resolveNode", { backendNodeId: hit.backendNodeId, executionContextId: contextId }, node2.sessionId);
      if (!hitObject.object.objectId) throw new BrowserError("BROWSER_ERROR", "无法核对点击位置");
      try {
        const matches = await this.proxy.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: "function(hit){return this.isConnected&&globalThis.__wyBrowserGuard.valid()&&(this===hit||this.contains(hit))}",
          arguments: [{ objectId: hitObject.object.objectId }],
          returnByValue: true
        }, node2.sessionId);
        if (!matches.result.value) {
          if (!await connected()) throw staleReference();
          throw new BrowserError("BROWSER_ERROR", "目标被其他元素遮挡");
        }
      } finally {
        await this.proxy.send("Runtime.releaseObject", { objectId: hitObject.object.objectId }, node2.sessionId).catch(() => {
        });
      }
      check();
      if (!await connected()) throw staleReference();
      if (kind === "hover") await this.proxy.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 }, node2.sessionId);
      else for (let count = 1; count <= (kind === "dblclick" ? 2 : 1); count++) {
        check();
        if (!await connected()) throw staleReference();
        await this.proxy.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: count }, node2.sessionId);
        await this.proxy.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: count }, node2.sessionId);
      }
      check();
      return { clicked: ref2, path: "cdp" };
    };
    return {
      selector: `[data-willyou-ref="${nonce}"]`,
      node: node2,
      hostClick,
      click: (options2) => pointer("click", options2),
      pointer: async (kind, options2) => {
        await pointer(kind, options2);
      },
      scroll: async (options2 = {}) => {
        if (options2.signal?.aborted) throw options2.signal.reason;
        options2.dispatched?.();
        await this.proxy.send("DOM.scrollIntoViewIfNeeded", { objectId }, node2.sessionId);
      },
      highlight: async (options2 = {}) => {
        if (options2.signal?.aborted) throw options2.signal.reason;
        options2.dispatched?.();
        const result = await this.proxy.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function(){
          if(!this.isConnected||!globalThis.__wyBrowserGuard.valid())return false;
          const outline=this.style.outline,offset=this.style.outlineOffset;
          this.style.outline='2px solid red';this.style.outlineOffset='2px';
          const appliedOutline=this.style.outline,appliedOffset=this.style.outlineOffset,element=this;
          setTimeout(()=>{if(element.style.outline===appliedOutline)element.style.outline=outline;if(element.style.outlineOffset===appliedOffset)element.style.outlineOffset=offset;},3000);return true;
        }`,
          returnByValue: true
        }, node2.sessionId);
        if (result.result.value !== true) {
          options2.notStarted?.();
          throw staleReference();
        }
      },
      fill: async (value, options2 = {}) => {
        const check = () => {
          if (options2.signal?.aborted) throw options2.signal.reason ?? new BrowserError("BROWSER_ERROR", "填写已取消");
        };
        check();
        options2.dispatched?.();
        const selected = await this.proxy.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function(){
          const guard=globalThis.__wyBrowserGuard;
          if(!guard.valid()||!this.isConnected)return 'stale-before-action';
          const textInput=this instanceof HTMLInputElement||this instanceof HTMLTextAreaElement;
          if(!textInput&&!this.isContentEditable||textInput&&(this.disabled||this.readOnly))return 'unsupported-before-action';
          this.focus();
          if(!guard.valid()||!this.isConnected)return 'stale-after-focus';
          const focused=this.getRootNode().activeElement??this.ownerDocument.activeElement;
          if(focused!==this&&!this.contains(focused))return 'focus-failed';
          if(textInput)this.select();
          else {
            const root=this.getRootNode(),selection=typeof root.getSelection==='function'?root.getSelection():this.ownerDocument.getSelection();
            if(!selection)return 'unsupported';
            const range=this.ownerDocument.createRange();range.selectNodeContents(this);selection.removeAllRanges();selection.addRange(range);
          }
          return guard.valid()&&this.isConnected?'selected':'stale-after-focus';
        }`,
          returnByValue: true
        }, node2.sessionId);
        if (selected.result.value === "stale-before-action") {
          options2.notStarted?.();
          throw staleReference();
        }
        if (selected.result.value === "unsupported-before-action") {
          options2.notStarted?.();
          throw new ApplicationError("INVALID_INPUT", "这个元素不能按文本框填写");
        }
        if (selected.result.value === "stale-after-focus") throw staleReference();
        if (selected.result.value !== "selected" || selected.exceptionDetails) throw new BrowserError("BROWSER_ERROR", "这个元素不能按文本框填写");
        check();
        const valid = await this.proxy.send("Runtime.callFunctionOn", { objectId, functionDeclaration: "function(){return this.isConnected&&globalThis.__wyBrowserGuard.valid()}", returnByValue: true }, node2.sessionId);
        if (!valid.result.value) throw staleReference();
        await this.proxy.send("Input.insertText", { text: value }, node2.sessionId);
        check();
        return { filled: ref2 };
      },
      read: async (what) => {
        const result = await this.proxy.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function(what){
          if(!this.isConnected||!globalThis.__wyBrowserGuard.valid())return {valid:false};
          const rect=this.getBoundingClientRect(),style=getComputedStyle(this);
          let checked=false;
          if(this.matches('input[type="checkbox"],input[type="radio"]'))checked=this.checked;
          else if(['checkbox','radio','switch','menuitemcheckbox','menuitemradio','option','treeitem'].includes(this.getAttribute('role')))checked=this.getAttribute('aria-checked')==='true';
          else {const label=this.closest('label'),input=label?.control??this.querySelector('input[type="checkbox"],input[type="radio"]');checked=!!input?.checked;}
          const values={text:this.innerText||this.textContent||'',html:this.innerHTML,value:this.value??(this.isContentEditable?this.textContent:null),box:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},visible:!!(rect.width&&rect.height)&&style.visibility!=='hidden'&&style.display!=='none',enabled:!this.matches(':disabled')&&this.getAttribute('aria-disabled')!=='true',checked,selected:this instanceof HTMLSelectElement?Array.from(this.selectedOptions,option=>option.value):null};
          return {valid:true,value:values[what]};
        }`,
          arguments: [{ value: what }],
          returnByValue: true
        }, node2.sessionId);
        if (!result.result.value?.valid) throw staleReference();
        return result.result.value.value;
      },
      select: async (value, options2 = {}) => {
        if (options2.signal?.aborted) throw options2.signal.reason;
        options2.dispatched?.();
        const result = await this.proxy.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function(value){
          const guard=globalThis.__wyBrowserGuard;
          if(!this.isConnected||!guard.valid())return 'stale';
          if(!(this instanceof HTMLSelectElement)||this.disabled)return 'unsupported';
          const option=Array.from(this.options).find(option=>option.value===value||option.label===value);
          if(!option||option.disabled)return 'missing';
          this.value=option.value;this.dispatchEvent(new Event('input',{bubbles:true}));
          if(!this.isConnected||!guard.valid())return 'changed';
          this.dispatchEvent(new Event('change',{bubbles:true}));return 'selected';
        }`,
          arguments: [{ value }],
          returnByValue: true
        }, node2.sessionId);
        if (result.result.value === "stale") {
          options2.notStarted?.();
          throw staleReference();
        }
        if (result.result.value === "changed") throw staleReference();
        if (result.result.value !== "selected") {
          options2.notStarted?.();
          throw new ApplicationError("INVALID_INPUT", "选项不存在、已禁用或元素不是选择框");
        }
      },
      focus: async (options2 = {}) => {
        if (options2.signal?.aborted) throw options2.signal.reason;
        options2.dispatched?.();
        const result = await this.proxy.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function(){const guard=globalThis.__wyBrowserGuard;if(!this.isConnected||!guard.valid())return 'stale';this.focus();if(!this.isConnected||!guard.valid())return 'changed';const focused=this.getRootNode().activeElement??this.ownerDocument.activeElement;return focused===this||this.contains(focused)?'focused':'failed';}`,
          returnByValue: true
        }, node2.sessionId);
        if (result.result.value === "stale") {
          options2.notStarted?.();
          throw staleReference();
        }
        if (result.result.value === "changed") throw staleReference();
        if (result.result.value !== "focused") throw new BrowserError("BROWSER_ERROR", "目标未取得焦点");
      },
      upload: async (files, options2 = {}) => {
        if (options2.signal?.aborted) throw options2.signal.reason;
        const allowed = await this.proxy.send("Runtime.callFunctionOn", { objectId, functionDeclaration: 'function(count){return this.isConnected&&globalThis.__wyBrowserGuard.valid()&&this instanceof HTMLInputElement&&this.type==="file"&&!this.disabled&&(count<=1||this.multiple)}', arguments: [{ value: files.length }], returnByValue: true }, node2.sessionId);
        if (!allowed.result.value) {
          options2.notStarted?.();
          throw new ApplicationError("INVALID_INPUT", "上传目标不是可用文件框或不支持多个文件");
        }
        options2.dispatched?.();
        await this.proxy.send("DOM.setFileInputFiles", { objectId, files }, node2.sessionId);
      },
      selectAll: async (options2 = {}) => {
        if (options2.signal?.aborted) throw options2.signal.reason;
        options2.dispatched?.();
        const result = await this.proxy.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function(){
          const guard=globalThis.__wyBrowserGuard;if(!this.isConnected||!guard.valid())return false;
          this.focus();if(!this.isConnected||!guard.valid())return false;
          if(this instanceof HTMLInputElement||this instanceof HTMLTextAreaElement)this.select();
          else if(this.isContentEditable){const selection=this.ownerDocument.getSelection(),range=this.ownerDocument.createRange();range.selectNodeContents(this);selection.removeAllRanges();selection.addRange(range);}
          else return false;return true;
        }`,
          returnByValue: true
        }, node2.sessionId);
        if (!result.result.value) throw new BrowserError("BROWSER_ERROR", "目标不能选中文本或操作期间已替换");
      },
      finish: (preserve = false) => this.disarm(node2, contextId, objectId, preserve, locator)
    };
  }
  async disarm(node2, contextId, objectId, preserve = false, locator = true) {
    try {
      const result = await this.proxy.send("Runtime.evaluate", { expression: preserve ? "globalThis.__wyBrowserGuard.state()" : "globalThis.__wyBrowserGuard.disarm()", contextId, returnByValue: true }, node2.sessionId);
      return result.result.value;
    } finally {
      if (locator) await this.proxy.send("Runtime.callFunctionOn", { objectId, functionDeclaration: 'function(){this.removeAttribute("data-willyou-ref")}' }, node2.sessionId).catch(() => {
      });
      await this.proxy.send("Runtime.releaseObject", { objectId }, node2.sessionId).catch(() => {
      });
    }
  }
}
class BrowserPageQueue {
  tail = Promise.resolve();
  closed = false;
  pending = /* @__PURE__ */ new Set();
  run(admit, work, signal) {
    const check = () => {
      if (this.closed) throw new BrowserError("BROWSER_TAB_CLOSED", "网页已经关闭");
      if (signal?.aborted) throw signal.reason ?? new BrowserError("BROWSER_ERROR", "操作已取消");
      admit();
    };
    try {
      check();
    } catch (error2) {
      return Promise.reject(error2);
    }
    return new Promise((resolve, reject) => {
      let waiting = true;
      const cleanup = () => {
        this.pending.delete(cancel);
        signal?.removeEventListener("abort", aborted2);
      };
      const cancel = (reason) => {
        if (!waiting) return;
        waiting = false;
        cleanup();
        reject(reason);
      };
      const aborted2 = () => cancel(signal?.reason ?? new BrowserError("BROWSER_ERROR", "操作已取消"));
      this.pending.add(cancel);
      signal?.addEventListener("abort", aborted2, { once: true });
      this.tail = this.tail.then(async () => {
        if (!waiting) return;
        waiting = false;
        cleanup();
        try {
          check();
          resolve(await work());
        } catch (error2) {
          reject(error2);
        }
      });
    });
  }
  cancelQueued(reason) {
    for (const cancel of this.pending) cancel(reason);
  }
  close() {
    this.closed = true;
    this.cancelQueued(new BrowserError("BROWSER_TAB_CLOSED", "网页已经关闭"));
  }
  async settled() {
    await this.tail;
  }
}
class BrowserParkWindow {
  window;
  preparing;
  async ensure() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.preparing ??= (async () => {
      const bounds = electron.screen.getPrimaryDisplay().workArea;
      const window = new electron.BrowserWindow({ x: bounds.x, y: bounds.y, width: Math.max(800, bounds.width), height: Math.max(600, bounds.height), show: false, opacity: 0, focusable: false, skipTaskbar: true, hasShadow: false, title: "WillYou browser background", webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      window.setIgnoreMouseEvents(true);
      await window.loadURL("data:text/html,<title>WillYou browser background</title>");
      window.showInactive();
      this.window = window;
      return window;
    })();
    try {
      return await this.preparing;
    } finally {
      this.preparing = void 0;
    }
  }
  async park(view, rect) {
    const window = await this.ensure();
    window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
  }
  remove(view) {
    if (this.window && !this.window.isDestroyed() && this.window.contentView.children.includes(view)) this.window.contentView.removeChildView(view);
  }
  dispose() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = void 0;
  }
}
const browserProfileSchema = object({
  id: string().regex(/^(?:project-[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/),
  scope: _enum(["project", "isolated", "imported"]),
  partition: string().min(1),
  label: string().trim().min(1).max(120),
  owner: object({ kind: _enum(["project", "task"]), id: string().min(1) }).strict(),
  source: object({ family: _enum(["chrome", "edge"]), profile: string().min(1), importedAt: number().finite() }).strict().nullable()
}).strict().superRefine((profile, context) => {
  if (profile.partition !== "persist:wy-browser-" + profile.id || profile.scope === "project" && profile.owner.kind !== "project" || profile.scope !== "project" && profile.owner.kind !== "task") context.addIssue({ code: "custom", message: "登录态分区或归属无效" });
});
const browserProfilesSchema = object({ schemaVersion: literal(1), profiles: array(browserProfileSchema) }).strict().superRefine((value, context) => {
  if (new Set(value.profiles.map((profile) => profile.id)).size !== value.profiles.length || new Set(value.profiles.filter((profile) => profile.scope === "project").map((profile) => profile.owner.id)).size !== value.profiles.filter((profile) => profile.scope === "project").length) context.addIssue({ code: "custom", message: "登录态身份重复" });
});
const KEY$1 = "browserProfiles.v1";
const browserProjectProfile = (projectId) => "project-" + browserDigest(projectId).slice(0, 24);
class BrowserProfiles {
  constructor(options) {
    this.options = options;
    const row = options.sqlite.prepare("SELECT value FROM app_settings WHERE key=?").get(KEY$1);
    if (row) {
      let stored;
      try {
        if (Buffer.byteLength(row.value) > 4 * 1024 * 1024) throw Error();
        stored = browserProfilesSchema.parse(JSON.parse(row.value));
      } catch {
        throw new ApplicationError("BROWSER_UNAVAILABLE", "登录态元数据损坏；原数据已保留，请恢复后重试");
      }
      for (const profile of stored.profiles) {
        if (profile.owner.kind === "project" && profile.id !== browserProjectProfile(profile.owner.id)) throw new ApplicationError("BROWSER_UNAVAILABLE", "项目登录态身份与归属不符，原记录保留");
        this.profiles.set(profile.id, profile);
      }
    }
  }
  profiles = /* @__PURE__ */ new Map();
  busy = /* @__PURE__ */ new Map();
  unavailable = /* @__PURE__ */ new Map();
  persist(dispatched = () => {
  }) {
    const value = JSON.stringify(browserProfilesSchema.parse({ schemaVersion: 1, profiles: [...this.profiles.values()] }));
    if (Buffer.byteLength(value) > 4 * 1024 * 1024) throw new ApplicationError("TOO_LARGE", "登录态元数据超过4MiB上限");
    dispatched();
    this.options.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(KEY$1, value, Date.now());
  }
  ensureProject(projectId) {
    const id2 = browserProjectProfile(projectId), found = this.profiles.get(id2);
    if (found) {
      if (found.scope !== "project" || found.owner.id !== projectId) throw new ApplicationError("BROWSER_UNAVAILABLE", "项目登录态归属损坏");
      return found;
    }
    const profile = { id: id2, scope: "project", partition: "persist:wy-browser-" + id2, label: "项目登录态", owner: { kind: "project", id: projectId }, source: null };
    this.profiles.set(id2, profile);
    try {
      this.persist();
    } catch (error2) {
      this.profiles.delete(id2);
      throw error2;
    }
    return profile;
  }
  visible(caller, profile, mode) {
    if (this.options.taskProject(caller.taskId) !== caller.projectId) return false;
    if (profile.owner.kind === "project") return profile.owner.id === caller.projectId;
    return this.options.taskProject(profile.owner.id) === caller.projectId && (profile.owner.id === caller.taskId || this.options.authorized?.(caller, profile.owner.id, mode) === true);
  }
  require(caller, id2, mode = "observe") {
    const profile = this.profiles.get(id2);
    if (!profile || !this.visible(caller, profile, mode)) throw new ApplicationError("SCOPE_DENIED", "当前运行无权访问该登录态");
    return profile;
  }
  list(caller) {
    if (this.options.taskProject(caller.taskId) !== caller.projectId) throw new ApplicationError("SCOPE_DENIED", "任务不属于当前项目");
    this.ensureProject(caller.projectId);
    return [...this.profiles.values()].filter((profile) => this.visible(caller, profile, "observe"));
  }
  create(caller, label, scope2 = "isolated", dispatched = () => {
  }) {
    if (this.options.taskProject(caller.taskId) !== caller.projectId) throw new ApplicationError("SCOPE_DENIED", "任务不属于当前项目");
    const id2 = node_crypto.randomUUID(), parsed = browserProfileSchema.safeParse({ id: id2, scope: scope2, partition: "persist:wy-browser-" + id2, label, owner: { kind: "task", id: caller.taskId }, source: null });
    if (!parsed.success) throw new ApplicationError("INVALID_INPUT", "登录态名称须为1到120字符，scope须为isolated或imported");
    this.profiles.set(id2, parsed.data);
    try {
      this.persist(dispatched);
    } catch (error2) {
      this.profiles.delete(id2);
      throw error2;
    }
    return parsed.data;
  }
  deletable(caller, id2) {
    const profile = this.require(caller, id2, "control");
    if (profile.scope === "project") throw new ApplicationError("INVALID_INPUT", "项目登录态不可单独删除");
    return profile;
  }
  known(id2) {
    return this.profiles.get(id2);
  }
  all() {
    return [...this.profiles.values()];
  }
  assertAvailable(id2) {
    if (this.unavailable.has(id2)) throw new ApplicationError("BROWSER_UNAVAILABLE", this.unavailable.get(id2) === "importing" ? "正在导入或恢复登录态" : "登录态需要处理，请重试恢复或清空登录态");
    if (this.busy.has(id2)) throw new ApplicationError("BROWSER_UNAVAILABLE", "登录态正在" + this.busy.get(id2) + "，请稍后重试");
  }
  importState(id2) {
    return this.unavailable.get(id2) ?? "ready";
  }
  setImportState(id2, state2) {
    if (state2 === "ready") this.unavailable.delete(id2);
    else this.unavailable.set(id2, state2);
  }
  /** One lifecycle mutation per partition; callers must release in finally. */
  lock(id2, reason) {
    if (!this.profiles.has(id2)) throw new ApplicationError("SCOPE_DENIED", "当前运行无权访问该登录态");
    if (this.busy.has(id2)) throw new ApplicationError("RESOURCE_BUSY", "登录态正在" + this.busy.get(id2));
    this.busy.set(id2, reason);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.busy.delete(id2);
      }
    };
  }
  setSource(id2, source) {
    const previous = this.profiles.get(id2);
    if (!previous) throw new ApplicationError("SCOPE_DENIED", "登录态不存在");
    const next = browserProfileSchema.parse({ ...previous, source });
    this.profiles.set(id2, next);
    try {
      this.persist();
    } catch (error2) {
      this.profiles.set(id2, previous);
      throw error2;
    }
  }
  /** Internal cleanup after session storage has been cleared; never a caller-facing bypass. */
  forget(id2) {
    const previous = this.profiles.get(id2);
    if (!previous) return;
    this.profiles.delete(id2);
    try {
      this.persist();
    } catch (error2) {
      this.profiles.set(id2, previous);
      throw error2;
    }
  }
}
function awaitBrowserNavigation(navigation, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (success, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted2);
      success ? resolve(value) : reject(value);
    };
    const aborted2 = () => finish(false, signal.reason ?? new ApplicationError("CANCELED", "导航等待已取消"));
    signal.addEventListener("abort", aborted2, { once: true });
    void navigation.then((value) => finish(true, value), (error2) => finish(false, error2));
    if (signal.aborted) aborted2();
  });
}
class BrowserPageRegistry {
  constructor(options) {
    this.options = options;
  }
  pages = /* @__PURE__ */ new Map();
  active = /* @__PURE__ */ new Map();
  park = new BrowserParkWindow();
  mounted;
  observers = /* @__PURE__ */ new Set();
  closing = /* @__PURE__ */ new Map();
  navigationRequests = /* @__PURE__ */ new WeakMap();
  initializing = /* @__PURE__ */ new Map();
  observe(listener) {
    this.observers.add(listener);
    return () => {
      this.observers.delete(listener);
    };
  }
  publish(type, page) {
    for (const listener of this.observers) listener({ type, page });
  }
  list(taskId) {
    return [...this.pages.values()].filter((page) => page.taskId === taskId && !page.closed);
  }
  all() {
    return [...this.pages.values()].filter((page) => !page.closed);
  }
  trackInitialization(contents, profileId) {
    let finish;
    const settled = new Promise((resolve) => {
      finish = resolve;
    });
    this.initializing.set(contents, { profileId, settled, finish });
    return () => {
      this.initializing.delete(contents);
      finish();
    };
  }
  /** Called only with the profile lifecycle lock held. Closing unpublished
   * contents prevents a late popup/create from writing after a data clear. */
  async cancelProfileInitializations(profileId) {
    const pending = [...this.initializing].filter(([, entry]) => entry.profileId === profileId);
    for (const [contents] of pending) if (!contents.isDestroyed()) contents.close();
    await Promise.all(pending.map(([, entry]) => entry.settled));
  }
  get(taskId, id2) {
    const page = this.pages.get(id2 ?? this.active.get(taskId) ?? "");
    if (!page || page.closed || page.contents.isDestroyed() || page.taskId !== taskId) throw new BrowserError(id2 ? "BROWSER_TAB_NOT_FOUND" : "BROWSER_NO_TAB", "本任务没有这个网页标签");
    return page;
  }
  async create(taskId, projectId, savedId, requestedProfile) {
    const id2 = savedId ?? node_crypto.randomUUID(), short = "k" + node_crypto.randomUUID().replaceAll("-", "");
    const defaultProfile = this.options.profiles?.ensureProject(projectId), profileId = requestedProfile ?? defaultProfile?.id ?? browserProjectProfile(projectId);
    if (requestedProfile && requestedProfile !== browserProjectProfile(projectId) && !this.options.profiles) throw new BrowserError("BROWSER_UNAVAILABLE", "登录态注册表尚未就绪");
    const profile = this.options.profiles?.require({ taskId, projectId }, profileId), partition2 = profile?.partition ?? "persist:wy-browser-" + profileId;
    this.options.profiles?.assertAvailable(profileId);
    if (this.pages.has(id2)) throw new BrowserError("BROWSER_ERROR", "网页身份已经存在");
    const view = new electron.WebContentsView({ webPreferences: { partition: partition2, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const initialized = this.trackInitialization(view.webContents, profileId);
    const proxy = new BrowserCdpProxy(view.webContents), references = new BrowserReferences(proxy, short);
    const page = { id: id2, short, taskId, projectId, profileId, view, contents: view.webContents, proxy, references, helper: void 0, queue: new BrowserPageQueue(), rect: { x: 0, y: 0, width: 1e3, height: 700 }, closed: false, abort: new AbortController(), hostNavigation: null, kind: "tab" };
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const denyUnsafeNavigation = (event, url2) => {
      try {
        const protocol = new URL(url2).protocol;
        if (protocol === "javascript:") return;
        const localLink = protocol === "file:" && view.webContents.getURL().startsWith("file:");
        if (!["http:", "https:", "about:"].includes(protocol) && url2 !== page.hostNavigation && !localLink) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    };
    view.webContents.on("will-navigate", denyUnsafeNavigation);
    view.webContents.on("will-redirect", (event, url2) => {
      if (url2.startsWith("file:")) event.preventDefault();
      else denyUnsafeNavigation(event, url2);
    });
    try {
      this.options.configure?.(page);
      await this.park.park(view, page.rect);
      await view.webContents.loadURL("about:blank");
      await proxy.start();
      await references.initialize();
      page.helper = new BrowserHelper({
        ...this.options.helper,
        home: node_path.join(this.options.userData, "browser/agent-browser-home", id2),
        // Darwin Unix-domain sockets have a short pathname limit. The home remains under userData.
        sockets: node_path.join("/private/tmp", "wy-ab-" + browserDigest(this.options.userData + id2).slice(0, 24)),
        session: "wy-" + short,
        endpoint: proxy.endpoint
      }, () => references.invalidate());
      this.options.profiles?.assertAvailable(profileId);
      this.pages.set(id2, page);
      if (!this.active.has(taskId)) this.active.set(taskId, id2);
      this.publish("created", page);
      return page;
    } catch (error2) {
      await proxy.stop();
      this.park.remove(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
      throw error2;
    } finally {
      initialized();
    }
  }
  /** Electron binds the opener to the returned WebContents. The child uses its
   * own native window and the opener's exact session, never an App preload. */
  createPopup(opener, options, asTab = false) {
    this.options.profiles?.assertAvailable(opener.profileId);
    const id2 = node_crypto.randomUUID(), short = "k" + node_crypto.randomUUID().replaceAll("-", "");
    const view = new electron.WebContentsView({ ...options.webContents === void 0 ? {} : { webContents: options.webContents }, webPreferences: { ...options.webPreferences, session: opener.contents.session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
    const contents = view.webContents;
    const initialized = this.trackInitialization(contents, opener.profileId);
    const window = asTab ? void 0 : new electron.BaseWindow({ width: Math.max(320, Math.min(options.width ?? 800, 1400)), height: Math.max(240, Math.min(options.height ?? 600, 1e3)), show: false, title: "WillYou · 网页登录" });
    const bounds = window?.getContentBounds() ?? { width: 1e3, height: 700 };
    window?.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
    const proxy = new BrowserCdpProxy(contents), references = new BrowserReferences(proxy, short);
    const page = { id: id2, short, taskId: opener.taskId, projectId: opener.projectId, profileId: opener.profileId, view, contents, proxy, references, helper: void 0, queue: new BrowserPageQueue(), rect: { x: 0, y: 0, width: bounds.width, height: bounds.height }, closed: false, abort: new AbortController(), hostNavigation: null, kind: asTab ? "tab" : "popup", openerPageId: opener.id, popupWindow: window };
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    const guard = (event, url2) => {
      try {
        if (!["http:", "https:", "about:", "javascript:"].includes(new URL(url2).protocol)) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    };
    contents.on("will-navigate", guard);
    contents.on("will-redirect", guard);
    window?.on("resize", () => {
      if (!contents.isDestroyed()) {
        const r = window.getContentBounds();
        view.setBounds({ x: 0, y: 0, width: r.width, height: r.height });
      }
    });
    window?.on("closed", () => {
      if (this.pages.has(id2)) void this.close(page.taskId, id2);
      else if (!contents.isDestroyed()) contents.close();
    });
    contents.on("destroyed", () => {
      if (this.pages.has(id2)) void this.close(page.taskId, id2);
    });
    void (async () => {
      try {
        this.options.configure?.(page);
        if (asTab) await this.park.park(view, page.rect);
        await proxy.start();
        await references.initialize();
        if (contents.isDestroyed() || opener.closed) throw new BrowserError("BROWSER_TAB_CLOSED", "来源页面已关闭");
        this.options.profiles?.assertAvailable(opener.profileId);
        page.helper = new BrowserHelper({ ...this.options.helper, home: node_path.join(this.options.userData, "browser/agent-browser-home", id2), sockets: node_path.join("/private/tmp", "wy-ab-" + browserDigest(this.options.userData + id2).slice(0, 24)), session: "wy-" + short, endpoint: proxy.endpoint }, () => references.invalidate());
        this.pages.set(id2, page);
        this.publish("created", page);
        if (this.mounted?.taskId === page.taskId) window?.showInactive();
      } catch {
        await proxy.stop();
        this.park.remove(view);
        if (window && !window.isDestroyed()) window.close();
        if (!contents.isDestroyed()) contents.close();
      } finally {
        initialized();
      }
    })();
    return contents;
  }
  async navigate(page, url2, signal) {
    this.options.profiles?.assertAvailable(page.profileId);
    await this.navigateOwned(page, url2, signal);
  }
  /** Import coordinator only: keep its lifecycle lock through the reload so
   * deletion/another import cannot race the final navigation batch. */
  async resumeAfterImport(page, url2, signal) {
    if (!page.importPaused) throw new BrowserError("BROWSER_UNAVAILABLE", "网页没有待恢复的导入占位状态");
    page.abort = new AbortController();
    page.importPaused = false;
    await this.navigateOwned(page, url2, signal);
  }
  async navigateOwned(page, url2, signal) {
    const navigationSignal = signal ? AbortSignal.any([page.abort.signal, signal]) : page.abort.signal;
    if (navigationSignal.aborted) throw navigationSignal.reason ?? new BrowserError("BROWSER_TAB_CLOSED", "网页已关闭");
    let normalized;
    try {
      const parsed = new URL(url2);
      if (!["http:", "https:", "file:", "about:"].includes(parsed.protocol) || parsed.protocol === "about:" && url2 !== "about:blank") throw Error();
      normalized = parsed.href;
    } catch {
      throw new BrowserError("BROWSER_ERROR", "请输入有效的 http(s)、file 或 about:blank 地址");
    }
    const request = {};
    this.navigationRequests.set(page, request);
    page.references.invalidate();
    page.hostNavigation = normalized;
    const navigation = (async () => {
      try {
        await page.contents.loadURL(normalized);
      } finally {
        if (this.navigationRequests.get(page) === request) {
          this.navigationRequests.delete(page);
          page.hostNavigation = null;
        }
      }
    })();
    await awaitBrowserNavigation(navigation, navigationSignal);
  }
  async placement(taskId, pageId, rect) {
    const page = this.get(taskId, pageId), window = this.options.window?.();
    if (page.kind === "popup") throw new BrowserError("BROWSER_ERROR", "子窗口不能挂到工作区");
    if (this.mounted && this.mounted !== page && window && !window.isDestroyed()) {
      window.contentView.removeChildView(this.mounted.view);
      await this.park.park(this.mounted.view, this.mounted.rect);
      this.mounted = void 0;
    }
    if (rect && window && !window.isDestroyed()) {
      if (!Object.values(rect).every(Number.isFinite) || rect.width < 1 || rect.height < 1) throw new BrowserError("BROWSER_ERROR", "网页显示区域无效");
      this.park.remove(page.view);
      window.contentView.addChildView(page.view);
      page.rect = rect;
      page.view.setBounds(rect);
      this.mounted = page;
      this.active.set(taskId, pageId);
    } else {
      if (this.mounted === page && window && !window.isDestroyed()) {
        window.contentView.removeChildView(page.view);
        this.mounted = void 0;
      }
      await this.park.park(page.view, page.rect);
    }
    for (const child of this.pages.values()) if (child.popupWindow && !child.popupWindow.isDestroyed()) {
      if (this.mounted?.taskId === child.taskId) child.popupWindow.showInactive();
      else child.popupWindow.hide();
    }
  }
  activate(taskId, pageId) {
    this.get(taskId, pageId);
    this.active.set(taskId, pageId);
  }
  isMounted(page) {
    return this.mounted === page;
  }
  close(taskId, pageId, fromPageQueue = false) {
    const page = this.pages.get(pageId);
    if (!page || page.taskId !== taskId) return Promise.reject(new BrowserError("BROWSER_TAB_NOT_FOUND", "本任务没有这个网页标签"));
    const pending = this.closing.get(pageId);
    if (pending) return pending;
    const closing = this.closePage(page, fromPageQueue).finally(() => {
      this.closing.delete(pageId);
    });
    this.closing.set(pageId, closing);
    return closing;
  }
  async closePage(page, fromPageQueue = false) {
    const { taskId, id: pageId } = page;
    page.closed = true;
    page.queue.close();
    page.abort.abort(new BrowserError("BROWSER_TAB_CLOSED", "网页已经关闭"));
    for (const child of this.list(taskId).filter((p) => p.kind === "popup" && p.openerPageId === pageId)) await this.close(taskId, child.id);
    await page.helper.close();
    if (!fromPageQueue) await page.queue.settled();
    await page.proxy.stop();
    const window = this.options.window?.();
    if (this.mounted === page && window && !window.isDestroyed()) {
      window.contentView.removeChildView(page.view);
      this.mounted = void 0;
    }
    this.park.remove(page.view);
    if (!page.contents.isDestroyed()) page.contents.close();
    if (page.popupWindow && !page.popupWindow.isDestroyed()) page.popupWindow.close();
    this.pages.delete(pageId);
    this.publish("closed", page);
    if (this.active.get(taskId) === pageId) {
      const next = this.list(taskId)[0];
      if (next) this.active.set(taskId, next.id);
      else this.active.delete(taskId);
    }
  }
  async dispose() {
    for (const page of [...this.pages.values()]) if (this.pages.has(page.id)) await this.close(page.taskId, page.id);
    this.park.dispose();
  }
}
const browserInputProgressSchema = object({
  confirmedChars: number().int().nonnegative(),
  inFlight: object({ offset: number().int().nonnegative(), length: number().int().positive() }).optional(),
  observed: object({ at: string().datetime(), length: number().int().nonnegative(), sha256: string().regex(/^[a-f0-9]{64}$/) }).optional()
});
class BrowserOperations {
  constructor(db2) {
    this.db = db2;
  }
  recover(now = Date.now()) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE browser_operations SET state='unknown',effect_state='unknown',updated_at=? WHERE state IN ('accepted','running')").run(now);
      this.db.prepare("DELETE FROM browser_operations WHERE created_at < ?").run(now - 7 * 864e5);
    })();
  }
  get(runId, requestId) {
    return this.db.prepare("SELECT * FROM browser_operations WHERE run_id=? AND request_id=?").get(runId, requestId) ?? null;
  }
  receipt(runId, requestId) {
    const row = this.get(runId, requestId);
    if (!row) return { state: "not-found" };
    const state2 = row.state === "accepted" || row.state === "running" ? "unknown" : row.state;
    const summary = row.summary === null ? null : JSON.parse(row.summary);
    return {
      requestId: row.request_id,
      pageId: row.page_id,
      command: row.command,
      state: state2,
      effectState: row.effect_state,
      progress: row.progress === null ? null : browserInputProgressSchema.parse(JSON.parse(row.progress)),
      summary,
      errorCode: row.error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  begin(runId, requestId, taskId, pageId, command) {
    return this.db.transaction(() => {
      const previous = this.get(runId, requestId);
      if (previous) {
        if (previous.task_id !== taskId || previous.command !== command || previous.page_id !== pageId)
          throw new ApplicationError("REQUEST_CONFLICT", "请求编号已属于另一浏览器操作");
        return { operation: previous, replay: true };
      }
      const now = Date.now();
      this.db.prepare("INSERT INTO browser_operations(run_id,request_id,task_id,page_id,command,state,effect_state,created_at,updated_at) VALUES(?,?,?,?,?,'accepted','not-started',?,?)").run(runId, requestId, taskId, pageId, command, now, now);
      return { operation: this.get(runId, requestId), replay: false };
    })();
  }
  update(runId, requestId, state2, effect, detail = {}) {
    const bounded = (value) => {
      if (value === void 0) return null;
      const json = JSON.stringify(value), bytes = Buffer.byteLength(json);
      return bytes <= 65536 ? json : JSON.stringify({ omitted: true, bytes, sha256: node_crypto.createHash("sha256").update(json).digest("hex") });
    };
    this.db.prepare("UPDATE browser_operations SET state=?,effect_state=?,progress=?,summary=?,error_code=?,updated_at=? WHERE run_id=? AND request_id=?").run(state2, effect, bounded(detail.progress), bounded(detail.summary), detail.code ?? null, Date.now(), runId, requestId);
  }
}
const commands = { "click": [], "dblclick": [], "type": [], "fill": [], "press": [], "keyboard": [], "hover": [], "focus": [], "check": [], "uncheck": [], "select": [], "drag": [], "upload": [], "scroll": [], "scrollintoview": [], "wait": [], "snapshot": ["-i", "--interactive", "-c", "--compact", "-d", "--depth", "-s", "--selector"], "eval": [], "back": [], "forward": [], "reload": [], "get": [], "is": [], "find": ["--name", "--exact"], "mouse": [], "set": [], "network": { "route": ["--abort", "--body", "--resource-type"], "unroute": [], "requests": ["--clear", "--filter", "--type", "--method", "--status"], "request": [] }, "cookies": ["--url", "--domain", "--path", "--httpOnly", "--secure", "--sameSite", "--expires"], "storage": [], "console": ["--clear"], "errors": ["--clear"], "highlight": [], "clipboard": [], "dialog": [], "diff": { "snapshot": [] }, "vitals": [], "pushstate": [] };
const policy = {
  commands
};
function browserExecArguments(source) {
  const args = [];
  let token = "", quote = "", escaped = false, started = false;
  for (const character of source) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
      started = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        args.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    token += character;
    started = true;
  }
  if (quote || escaped) throw new ApplicationError("INVALID_INPUT", "exec引号或转义不完整");
  if (started) args.push(token);
  const commands2 = policy.commands;
  let rule = commands2[args[0]], offset = 1;
  if (rule && !Array.isArray(rule)) {
    rule = rule[args[1]];
    offset = 2;
  }
  if (!Array.isArray(rule) || !args.length) throw new ApplicationError("INVALID_INPUT", "exec子命令不在固定白名单中");
  for (const arg of args.slice(offset)) if (arg.startsWith("-") && !rule.includes(arg.split("=")[0])) throw new ApplicationError("INVALID_INPUT", "exec包含未允许的参数");
  return args;
}
const BROWSER_BLANK_URL = "about:blank";
const SEARCH_ENGINES = {
  bing: { label: "Bing", url: "https://www.bing.com/search?q=" },
  google: { label: "Google", url: "https://www.google.com/search?q=" },
  duckduckgo: { label: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  kagi: { label: "Kagi", url: "https://kagi.com/search?q=" }
};
const local = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#].*)?$/i;
const dns = (name) => name.length > 0 && name.length <= 253 && name.split(".").every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
function normalizeBrowserNavigationUrl(raw2, engine) {
  const input = raw2.trim();
  if (!input || input === BROWSER_BLANK_URL) return BROWSER_BLANK_URL;
  if (/[\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    if (local.test(input)) return new URL("http://" + input).href;
    if (input.startsWith("/") || /^[A-Za-z]:[\\/]/.test(input)) {
      const path2 = input.replaceAll("\\", "/"), parts = path2.split("/").map((part, i) => i === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part));
      return (path2.startsWith("/") ? "file://" : "file:///") + parts.join("/");
    }
    if (/^\\\\[^\s\\/]+[\\/]/.test(input)) {
      const [host2, ...parts] = input.replaceAll("\\", "/").replace(/^\/+/, "").split("/");
      return "file://" + host2 + "/" + parts.map(encodeURIComponent).join("/");
    }
    const match = /^([^\s/\\:@?#]+):\d+(?:[/?#].*)?$/.exec(input);
    if (match?.[1].includes(".")) {
      const parsed = new URL("https://" + input), host2 = parsed.hostname.toLowerCase().replace(/\.$/, "");
      if (!dns(host2)) return null;
      if (host2.endsWith(".localhost")) parsed.protocol = "http:";
      return parsed.href;
    }
    try {
      const parsed = new URL(input);
      return ["http:", "https:", "file:"].includes(parsed.protocol) ? parsed.href : null;
    } catch {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return null;
      try {
        const parsed = new URL("https://" + input);
        const prose = /\s/.test(input) || !input.includes(".") && !input.includes(":");
        if (engine === void 0 || !prose) {
          if (parsed.hostname.toLowerCase().replace(/\.$/, "").endsWith(".localhost")) parsed.protocol = "http:";
          return parsed.href;
        }
      } catch {
      }
      return engine === void 0 ? null : SEARCH_ENGINES[engine].url + encodeURIComponent(input);
    }
  } catch {
    return null;
  }
}
function isBrowserSearchUrl(raw2) {
  try {
    const u = new URL(raw2);
    return Object.values(SEARCH_ENGINES).some((e) => {
      const base = new URL(e.url);
      return u.origin === base.origin && u.pathname === base.pathname && u.searchParams.has("q");
    });
  } catch {
    return false;
  }
}
function describeBrowserLoadFailure(code, description, url2) {
  let host2 = "", localHost = false;
  try {
    const u = new URL(url2);
    host2 = u.host;
    localHost = u.hostname === "localhost" || u.hostname.endsWith(".localhost") || /^127\./.test(u.hostname) || ["[::1]", "0.0.0.0", "[::]"].includes(u.hostname);
  } catch {
  }
  const kind = code === -102 ? localHost ? "not-running" : "refused" : code === -106 ? "offline" : [-105, -137].includes(code) ? "dns" : [-7, -118].includes(code) ? "timeout" : [-100, -101, -103, -324].includes(code) ? "reset" : "other";
  const titles = { "not-running": `${host2} 上还没有服务在运行`, refused: `${host2} 拒绝连接`, dns: `找不到 ${host2}`, offline: "当前处于离线", timeout: `${host2} 响应太久`, reset: `${host2} 连接被中断`, other: host2 ? `无法访问 ${host2}` : "无法加载此页面" };
  return { kind, url: url2, host: host2, title: titles[kind], errorName: /^(?:net::)?(ERR_[A-Z0-9_]+)$/.exec(description)?.[1] ?? description, recovery: kind === "not-running" ? "poll" : kind === "offline" ? "online" : null };
}
const browserTabSchema = object({ id: string().uuid(), url: string(), title: string(), profileId: string(), favicon: string().nullable() }).strict();
const browserWorkspaceSchema = object({ version: literal(1), tabs: array(browserTabSchema), activeId: string().uuid().nullable(), closed: array(browserTabSchema).max(10) }).strict().superRefine((state2, ctx) => {
  if (new Set(state2.tabs.map((t) => t.id)).size !== state2.tabs.length || state2.activeId && !state2.tabs.some((t) => t.id === state2.activeId)) ctx.addIssue({ code: "custom", message: "网页标签身份无效" });
});
const id = string().uuid();
const browserTaskInput = object({ taskId: id }).strict();
const browserTabInput = browserTaskInput.extend({ tabId: id }).strict();
browserTabInput.extend({ address: string() }).strict();
browserTabInput.extend({ action: _enum(["reload", "hard-reload", "stop", "back", "forward", "focus"]) }).strict();
browserTabInput.extend({ rect: object({ x: number().finite(), y: number().finite(), width: number().positive().finite(), height: number().positive().finite() }).strict().nullable() }).strict();
async function browserFavicon(session, url2, signal) {
  const maximum = 256 * 1024, types = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml", "image/bmp"]);
  try {
    let target = new URL(url2);
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(3e3)]);
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!["http:", "https:"].includes(target.protocol)) return null;
      const reply = await session.fetch(target.href, { redirect: "manual", credentials: "include", signal: bounded });
      if ([301, 302, 303, 307, 308].includes(reply.status)) {
        const location = reply.headers.get("location");
        await reply.body?.cancel();
        if (!location) return null;
        target = new URL(location, target);
        continue;
      }
      const type = reply.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      if (!reply.ok || !types.has(type) || Number(reply.headers.get("content-length")) > maximum) {
        await reply.body?.cancel();
        return null;
      }
      const reader = reply.body?.getReader();
      if (!reader) return null;
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > maximum) {
            await reader.cancel();
            return null;
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      return bytes ? "data:" + type + ";base64," + Buffer.concat(chunks).toString("base64") : null;
    }
  } catch {
  }
  return null;
}
function browserRecentVisit(recent, url2, title, visitedAt) {
  if (isBrowserSearchUrl(url2)) return recent;
  let host2;
  try {
    const parsed = new URL(url2);
    if (!["http:", "https:"].includes(parsed.protocol)) return recent;
    host2 = parsed.host;
  } catch {
    return recent;
  }
  return [{ url: url2, title, host: host2, visitedAt }, ...recent.filter((site) => site.host !== host2)].slice(0, 8);
}
function browserRecentTitle(recent, url2, title) {
  if (!recent.some((site) => site.url === url2 && site.title !== title)) return recent;
  return recent.map((site) => site.url === url2 ? { ...site, title } : site);
}
const idle = () => ({ loading: false, canGoBack: false, canGoForward: false, failure: null });
class BrowserWorkspace {
  constructor(options) {
    this.options = options;
    this.unobserve = options.pages.observe((event) => {
      if (event.type === "created") this.attached(event.page);
      else if (!this.shuttingDown) {
        const id2 = event.page.id;
        this.runtime.delete(id2);
        this.finds.delete(id2);
        this.navigations.delete(id2);
        this.overlays.delete(id2);
        this.cancelRecovery(id2);
        if (this.agentActive.get(event.page.taskId) === id2) this.agentActive.delete(event.page.taskId);
        if (event.page.kind !== "tab" || this.closingTabs.has(id2)) return;
        const state2 = this.tasks.get(event.page.taskId);
        if (state2) {
          state2.tabs = state2.tabs.filter((t) => t.id !== event.page.id);
          if (state2.activeId === event.page.id) state2.activeId = state2.tabs.at(-1)?.id ?? null;
          this.save(event.page.taskId);
        }
      }
    });
  }
  tasks = /* @__PURE__ */ new Map();
  runtime = /* @__PURE__ */ new Map();
  opening = /* @__PURE__ */ new Map();
  navigations = /* @__PURE__ */ new Map();
  closingTabs = /* @__PURE__ */ new Set();
  recovering = /* @__PURE__ */ new Map();
  notices = /* @__PURE__ */ new Map();
  external = /* @__PURE__ */ new Map();
  unobserve;
  shuttingDown = false;
  placementVersion = 0;
  finds = /* @__PURE__ */ new Map();
  agentActive = /* @__PURE__ */ new Map();
  profileChanges = /* @__PURE__ */ new Map();
  overlays = /* @__PURE__ */ new Set();
  reconciling;
  project(taskId) {
    const id2 = this.options.taskProject(taskId);
    if (!id2) throw new BrowserError("BROWSER_UNAVAILABLE", "只有所属项目仍存在的任务可以使用网页");
    return id2;
  }
  key(taskId) {
    return "browserWorkspace.v1:" + taskId;
  }
  load(taskId) {
    this.project(taskId);
    let state2 = this.tasks.get(taskId);
    if (state2) return state2;
    const row = this.options.sqlite.prepare("SELECT value FROM app_settings WHERE key=?").get(this.key(taskId));
    try {
      state2 = row ? browserWorkspaceSchema.parse(JSON.parse(row.value)) : { version: 1, tabs: [], activeId: null, closed: [] };
    } catch {
      throw new BrowserError("BROWSER_ERROR", "已保存的网页标签无法读取，原记录仍保留");
    }
    this.tasks.set(taskId, state2);
    return state2;
  }
  save(taskId) {
    if (this.shuttingDown) return;
    const state2 = this.tasks.get(taskId);
    if (!state2) return;
    const value = JSON.stringify(browserWorkspaceSchema.parse(state2));
    this.options.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(this.key(taskId), value, Date.now());
    this.options.changed?.(taskId);
  }
  changed(taskId) {
    this.options.changed?.(taskId);
  }
  snapshot(taskId) {
    const state2 = this.load(taskId), projectId = this.project(taskId);
    const row = this.options.sqlite.prepare("SELECT value FROM app_settings WHERE key=?").get("browserRecent.v1:" + projectId);
    let recent = [];
    if (row) try {
      const values = JSON.parse(row.value);
      if (Array.isArray(values)) recent = values.filter((r) => !!r && typeof r === "object" && typeof r.url === "string" && typeof r.title === "string" && typeof r.host === "string" && typeof r.visitedAt === "number").slice(0, 8);
    } catch {
    }
    const found = state2.activeId ? this.finds.get(state2.activeId) : void 0, auth = state2.activeId ? this.options.authentication?.(taskId, state2.activeId) : void 0;
    return { taskId, projectId, tabs: state2.tabs.map((tab) => ({ ...tab, ...this.runtime.get(tab.id) ?? idle(), ...this.options.profileState ? { importState: this.options.profileState(tab.profileId) } : {}, ...this.options.certificate ? { certificate: this.options.certificate(tab.id, this.runtime.get(tab.id)?.failure?.url ?? tab.url) } : {} })), activeId: state2.activeId, recent, notice: this.notices.get(taskId) ?? null, external: this.external.get(taskId) ?? null, find: { active: found?.active ?? 0, total: found?.total ?? 0 }, ...this.options.permission ? { permission: state2.activeId ? this.options.permission(taskId, state2.activeId) : null } : {}, ...this.options.downloads ? { downloads: this.options.downloads(taskId) } : {}, ...this.options.authentication ? { auth: auth?.prompt ?? null, authCancelled: auth?.cancelled ?? null } : {} };
  }
  certificateFailed(page, url2, error2) {
    if (page.closed || page.importPaused || this.shuttingDown) return;
    const runtime = this.runtime.get(page.id) ?? idle();
    runtime.loading = false;
    runtime.failure = describeBrowserLoadFailure(-202, error2, url2);
    this.runtime.set(page.id, runtime);
    this.cancelRecovery(page.id);
    this.changed(page.taskId);
  }
  create(taskId) {
    const state2 = this.load(taskId), id2 = node_crypto.randomUUID();
    state2.tabs.push({ id: id2, url: BROWSER_BLANK_URL, title: "新标签页", favicon: null, profileId: browserProjectProfile(this.project(taskId)) });
    state2.activeId = id2;
    this.save(taskId);
    return this.snapshot(taskId);
  }
  select(taskId, id2) {
    const state2 = this.load(taskId);
    if (id2 && !state2.tabs.some((t) => t.id === id2)) throw new BrowserError("BROWSER_TAB_NOT_FOUND", "本任务没有这个网页标签");
    state2.activeId = id2;
    if (id2) {
      this.agentActive.set(taskId, id2);
      if (this.options.pages.list(taskId).some((p) => p.id === id2)) this.options.pages.activate(taskId, id2);
    }
    this.save(taskId);
    return this.snapshot(taskId);
  }
  /** Agent activity can move while the user's file/page view remains unchanged. */
  commandTarget(taskId, id2, focus = false) {
    const state2 = this.load(taskId), live = this.options.pages.list(taskId), page = live.find((page2) => page2.id === id2);
    if (!state2.tabs.some((tab) => tab.id === id2) && !page) throw new BrowserError("BROWSER_TAB_NOT_FOUND", "本任务没有这个网页标签");
    const previous = this.agentActive.get(taskId) ?? state2.activeId;
    if (previous !== id2) {
      live.find((page2) => page2.id === previous)?.references.invalidate();
      page?.references.invalidate();
    }
    this.agentActive.set(taskId, id2);
    if (page) this.options.pages.activate(taskId, id2);
    if (focus) {
      if (page?.kind === "popup") page.popupWindow?.show();
      else {
        this.select(taskId, id2);
        this.options.shortcut?.(taskId, "show");
      }
    }
    this.changed(taskId);
  }
  ensure(taskId, id2) {
    const changing = this.profileChanges.get(id2);
    if (changing) return changing.then((page) => {
      if (!page) throw new BrowserError("BROWSER_NO_TAB", "启动页尚未加载网页");
      return page;
    });
    const live = this.options.pages.list(taskId).find((p) => p.id === id2);
    if (live) {
      this.options.available?.(live.profileId);
      return Promise.resolve(live);
    }
    const existing = this.opening.get(id2);
    if (existing) return existing;
    const state2 = this.load(taskId), tab = state2.tabs.find((t) => t.id === id2);
    if (!tab) return Promise.reject(new BrowserError("BROWSER_TAB_NOT_FOUND", "本任务没有这个网页标签"));
    this.options.available?.(tab.profileId);
    const promise = (async () => {
      const page = await this.options.pages.create(taskId, this.project(taskId), id2, tab.profileId);
      if (tab.url !== BROWSER_BLANK_URL) await this.loadUrl(page, tab.url);
      return page;
    })().finally(() => this.opening.delete(id2));
    this.opening.set(id2, promise);
    return promise;
  }
  /** Explicit Agent use of a startup tab initializes its engine lazily too. */
  async target(taskId, id2) {
    const state2 = this.load(taskId), target = id2 ?? this.agentActive.get(taskId) ?? state2.activeId;
    if (target) return this.ensure(taskId, target);
    const live = this.options.pages.list(taskId);
    if (live.length) return this.options.pages.get(taskId);
    const first = state2.tabs[0];
    if (first) return this.ensure(taskId, first.id);
    throw new BrowserError("BROWSER_NO_TAB", "本任务没有网页标签");
  }
  list(taskId) {
    const state2 = this.load(taskId), pages = [...state2.tabs.map((t) => ({ pageId: t.id, browserPageId: t.id, title: t.title, url: t.url, profileId: t.profileId, kind: "tab" })), ...this.options.pages.list(taskId).filter((p) => p.kind === "popup").map((p) => ({ pageId: p.id, browserPageId: p.id, title: p.contents.getTitle(), url: p.contents.getURL(), profileId: p.profileId, kind: "popup", openerPageId: p.openerPageId }))], active = this.agentActive.get(taskId) ?? state2.activeId ?? pages[0]?.pageId;
    return pages.map((page, index2) => ({ ...page, index: index2, active: page.pageId === active }));
  }
  async navigate(taskId, id2, address, engine = this.options.searchEngine?.() ?? "bing") {
    const url2 = normalizeBrowserNavigationUrl(address, engine);
    if (url2 === null) {
      this.notices.set(taskId, "请输入有效的 http(s) 或 localhost 地址");
      this.changed(taskId);
      return this.snapshot(taskId);
    }
    this.notices.delete(taskId);
    const state2 = this.load(taskId), tab = state2.tabs.find((t) => t.id === id2);
    if (!tab) throw new BrowserError("BROWSER_TAB_NOT_FOUND", "网页标签已关闭");
    if (url2 === BROWSER_BLANK_URL) {
      const live = this.options.pages.list(taskId).find((p) => p.id === id2);
      if (live) {
        this.closingTabs.add(id2);
        try {
          await this.options.pages.close(taskId, id2);
        } finally {
          this.closingTabs.delete(id2);
        }
      }
      tab.url = url2;
      tab.title = "新标签页";
      tab.favicon = null;
      this.runtime.delete(id2);
      this.save(taskId);
    } else {
      const page = await this.ensure(taskId, id2);
      await this.loadUrl(page, url2);
    }
    return this.snapshot(taskId);
  }
  async loadUrl(page, url2) {
    this.cancelRecovery(page.id);
    const run = this.runtime.get(page.id) ?? idle();
    run.failure = null;
    this.runtime.set(page.id, run);
    const request = { stopped: false };
    this.navigations.set(page.id, request);
    try {
      await this.options.pages.navigate(page, url2);
    } catch (error2) {
      if (page.closed || request.stopped || this.navigations.get(page.id) !== request) return;
      const message = error2 instanceof Error ? error2.message : String(error2);
      if (!run.failure && !message.includes("ERR_ABORTED")) {
        run.failure = describeBrowserLoadFailure(-2, "ERR_FAILED", url2);
        this.changed(page.taskId);
      }
    } finally {
      if (this.navigations.get(page.id) === request) this.navigations.delete(page.id);
    }
  }
  async action(taskId, id2, action) {
    const page = await this.target(taskId, id2), wc = page.contents;
    if (action === "focus") {
      wc.focus();
      return;
    }
    if (action === "stop") {
      const request = this.navigations.get(id2);
      if (request) request.stopped = true;
      wc.stop();
      this.cancelRecovery(id2);
      return;
    }
    const failure2 = this.runtime.get(id2)?.failure;
    if (failure2 && (action === "reload" || action === "hard-reload")) {
      await this.loadUrl(page, failure2.url);
      return;
    }
    if (action === "reload") wc.reload();
    else if (action === "hard-reload") wc.reloadIgnoringCache();
    else if (action === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === "forward" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }
  async placement(taskId, id2, rect) {
    const version2 = ++this.placementVersion;
    if (rect === null) {
      const live = this.options.pages.list(taskId).find((p) => p.id === id2);
      if (live) await this.options.pages.placement(taskId, id2, null);
      return;
    }
    if (this.overlays.has(id2)) return;
    const tab = this.load(taskId).tabs.find((t) => t.id === id2);
    if (!tab || tab.url === BROWSER_BLANK_URL || this.runtime.get(id2)?.failure || this.options.profileState?.(tab.profileId) !== void 0 && this.options.profileState(tab.profileId) !== "ready") return;
    const page = await this.ensure(taskId, id2);
    if (version2 !== this.placementVersion || this.overlays.has(id2)) return;
    await this.options.pages.placement(taskId, page.id, rect);
  }
  async overlay(taskId, id2, open2) {
    if (!this.load(taskId).tabs.some((tab) => tab.id === id2)) throw new BrowserError("BROWSER_TAB_NOT_FOUND", "网页标签已关闭");
    if (!open2) {
      this.overlays.delete(id2);
      return null;
    }
    this.overlays.add(id2);
    this.placementVersion++;
    const page = this.options.pages.list(taskId).find((page2) => page2.id === id2);
    if (!page) return null;
    try {
      const image = await page.contents.capturePage(), size = image.getSize(), thumbnail = size.width > 1920 ? image.resize({ width: 1920 }) : image;
      await this.placement(taskId, id2, null);
      return "data:image/jpeg;base64," + thumbnail.toJPEG(80).toString("base64");
    } catch (error2) {
      this.overlays.delete(id2);
      throw error2;
    }
  }
  async find(taskId, id2, text2, forward, next) {
    this.load(taskId);
    const page = this.options.pages.list(taskId).find((p) => p.id === id2);
    if (!page) {
      this.finds.delete(id2);
      this.changed(taskId);
      return;
    }
    this.options.available?.(page.profileId);
    const wc = page.contents;
    if (!text2) {
      wc.stopFindInPage("clearSelection");
      this.finds.delete(id2);
      this.changed(taskId);
      return;
    }
    const requestId = wc.findInPage(text2, { forward, findNext: !next });
    this.finds.set(id2, { requestId, active: 0, total: 0 });
  }
  async close(taskId, id2, fromPageQueue = false) {
    const changing = this.profileChanges.get(id2);
    if (changing) await changing;
    const state2 = this.load(taskId), tab = state2.tabs.find((t) => t.id === id2);
    if (!tab) return this.snapshot(taskId);
    this.cancelRecovery(id2);
    const pending = this.opening.get(id2);
    if (pending && !this.options.pages.list(taskId).some((p) => p.id === id2)) await pending;
    this.closingTabs.add(id2);
    try {
      if (this.options.pages.list(taskId).some((p) => p.id === id2)) await this.options.pages.close(taskId, id2, fromPageQueue);
    } finally {
      this.closingTabs.delete(id2);
    }
    state2.closed = [...state2.closed, tab].slice(-10);
    state2.tabs = state2.tabs.filter((t) => t.id !== id2);
    if (state2.activeId === id2) state2.activeId = state2.tabs.at(-1)?.id ?? null;
    this.runtime.delete(id2);
    this.save(taskId);
    return this.snapshot(taskId);
  }
  reopen(taskId) {
    const state2 = this.load(taskId), old = state2.closed.pop();
    if (old) {
      const tab = { ...old, id: node_crypto.randomUUID() };
      state2.tabs.push(tab);
      state2.activeId = tab.id;
      this.save(taskId);
    }
    return this.snapshot(taskId);
  }
  /** The persistent tab ID survives a partition change; the engine, helper and
   * reference scope do not. Old queued commands are rejected by the old queue. */
  setProfile(taskId, id2, profileId, admit, dispatched, signal) {
    if (this.profileChanges.has(id2)) return Promise.reject(new ApplicationError("RESOURCE_BUSY", "网页正在切换登录态"));
    if (this.opening.has(id2)) return Promise.reject(new ApplicationError("RESOURCE_BUSY", "网页引擎正在初始化，请稍后切换登录态"));
    const state2 = this.load(taskId), tab = state2.tabs.find((tab2) => tab2.id === id2), old = this.options.pages.list(taskId).find((page) => page.id === id2);
    if (!tab) return Promise.reject(new BrowserError("BROWSER_TAB_NOT_FOUND", "只有网页标签可以切换登录态；子窗口随来源页面关闭"));
    const work = async () => {
      admit();
      if (signal?.aborted) throw signal.reason;
      if (tab.profileId === profileId) return old;
      const active = this.agentActive.get(taskId) === id2, mounted = old && this.options.pages.isMounted(old), placement = this.placementVersion;
      const url2 = old?.contents.getURL() || tab.url;
      dispatched();
      this.closingTabs.add(id2);
      try {
        if (old) await this.options.pages.close(taskId, id2, true);
      } finally {
        this.closingTabs.delete(id2);
      }
      tab.profileId = profileId;
      tab.url = url2;
      tab.favicon = null;
      this.runtime.delete(id2);
      this.save(taskId);
      admit();
      if (signal?.aborted) throw signal.reason;
      if (!old || url2 === BROWSER_BLANK_URL) {
        if (active) this.agentActive.set(taskId, id2);
        return void 0;
      }
      const next = await this.options.pages.create(taskId, this.project(taskId), id2, profileId);
      if (active) {
        this.agentActive.set(taskId, id2);
        this.options.pages.activate(taskId, id2);
      }
      if (mounted && placement === this.placementVersion) await this.options.pages.placement(taskId, id2, old.rect);
      await this.loadUrl(next, url2);
      return next;
    };
    const promise = (old ? old.queue.run(admit, work, signal) : Promise.resolve().then(work)).finally(() => this.profileChanges.delete(id2));
    this.profileChanges.set(id2, promise);
    return promise;
  }
  /** Includes unloaded and recently closed tabs so deleting a profile cannot
   * resurrect its partition after restart or Reopen Closed Tab. */
  async removeProfileBindings(profileId, projectProfile, admit, dispatched) {
    const rows = this.options.sqlite.prepare("SELECT key FROM app_settings WHERE key LIKE ?").all("browserWorkspace.v1:%");
    const tasks = /* @__PURE__ */ new Set([...this.tasks.keys(), ...rows.map((row) => row.key.slice("browserWorkspace.v1:".length))]);
    for (const taskId of tasks) {
      if (!this.options.taskProject(taskId)) continue;
      const state2 = this.load(taskId);
      if (!state2.tabs.some((tab) => tab.profileId === profileId) && !state2.closed.some((tab) => tab.profileId === profileId)) continue;
      const replacement = projectProfile(taskId);
      for (const tab of state2.closed) if (tab.profileId === profileId) tab.profileId = replacement;
      while (true) {
        const tab = state2.tabs.find((tab2) => tab2.profileId === profileId);
        if (!tab) break;
        await this.setProfile(taskId, tab.id, replacement, admit, dispatched);
      }
      for (const tab of state2.closed) if (tab.profileId === profileId) tab.profileId = replacement;
      this.save(taskId);
    }
  }
  async confirmExternal(taskId, id2, allow) {
    const request = this.external.get(taskId);
    if (!request || request.id !== id2) throw new BrowserError("BROWSER_ERROR", "外部应用请求已失效");
    this.project(taskId);
    this.external.delete(taskId);
    this.changed(taskId);
    if (allow) await electron.shell.openExternal(request.url);
  }
  cancelRecovery(id2) {
    const timer = this.recovering.get(id2);
    if (timer) clearTimeout(timer);
    this.recovering.delete(id2);
  }
  scheduleRecovery(page) {
    this.cancelRecovery(page.id);
    const failure2 = this.runtime.get(page.id)?.failure;
    if (!failure2 || !failure2.recovery || this.shuttingDown) return;
    const timer = setTimeout(() => {
      this.recovering.delete(page.id);
      if (!page.closed && !page.importPaused && !this.shuttingDown) void this.loadUrl(page, failure2.url);
    }, failure2.recovery === "poll" ? 2e3 : 5e3);
    timer.unref();
    this.recovering.set(page.id, timer);
  }
  attached(page) {
    const state2 = this.load(page.taskId), wc = page.contents;
    if (page.kind === "tab" && !state2.tabs.some((t) => t.id === page.id)) {
      state2.tabs.push({ id: page.id, url: wc.getURL() || BROWSER_BLANK_URL, title: wc.getTitle() || "新标签页", favicon: null, profileId: page.profileId });
      if (page.openerPageId) state2.activeId = page.id;
      this.save(page.taskId);
    }
    const runtime = idle();
    this.runtime.set(page.id, runtime);
    const update = () => {
      if (page.closed || page.importPaused || wc.isDestroyed() || this.shuttingDown) return;
      runtime.loading = wc.isLoading();
      runtime.canGoBack = wc.navigationHistory.canGoBack();
      runtime.canGoForward = wc.navigationHistory.canGoForward();
      this.changed(page.taskId);
    };
    wc.on("did-start-loading", update);
    wc.on("did-stop-loading", update);
    wc.on("found-in-page", (_event, result) => {
      const query = this.finds.get(page.id);
      if (query?.requestId === result.requestId) {
        query.active = result.activeMatchOrdinal;
        query.total = result.matches;
        this.changed(page.taskId);
      }
    });
    let faviconGeneration = 0;
    const committed = () => {
      if (page.closed || page.importPaused || wc.isDestroyed()) return;
      runtime.failure = null;
      this.cancelRecovery(page.id);
      const tab = state2.tabs.find((t) => t.id === page.id);
      if (tab) {
        tab.url = wc.getURL();
        tab.title = wc.getTitle() || tab.url;
        this.save(page.taskId);
        this.remember(page.taskId, tab.url, tab.title);
      }
      update();
    };
    wc.on("did-navigate", () => {
      if (page.importPaused) return;
      faviconGeneration++;
      const tab = state2.tabs.find((t) => t.id === page.id);
      if (tab) tab.favicon = null;
      committed();
    });
    wc.on("did-navigate-in-page", (_event, _url2, main) => {
      if (main) committed();
    });
    wc.on("page-title-updated", (_event, title) => {
      if (page.importPaused) return;
      const tab = state2.tabs.find((t) => t.id === page.id);
      if (tab) {
        tab.title = title;
        this.save(page.taskId);
        const current = this.snapshot(page.taskId), recent = browserRecentTitle(current.recent, wc.getURL(), title);
        if (recent !== current.recent) this.saveRecent(current.projectId, recent);
      }
    });
    wc.on("page-favicon-updated", (_event, urls) => {
      if (page.importPaused) return;
      const generation = ++faviconGeneration, url2 = urls.find((url22) => /^https?:/.test(url22));
      const tab = state2.tabs.find((t) => t.id === page.id);
      if (!tab) return;
      if (!url2) {
        tab.favicon = null;
        this.save(page.taskId);
        return;
      }
      void browserFavicon(wc.session, url2, page.abort.signal).then((icon) => {
        if (!page.closed && !page.importPaused && !this.shuttingDown && generation === faviconGeneration && state2.tabs.includes(tab)) {
          tab.favicon = icon;
          this.save(page.taskId);
        }
      });
    });
    wc.on("did-fail-load", (_event, code, description, url2, main) => {
      if (!main || code === -3 || page.closed || page.importPaused) return;
      runtime.loading = false;
      const certificate = this.options.certificate?.(page.id, url2);
      runtime.failure = describeBrowserLoadFailure(certificate?.challengeId ? -202 : code, certificate?.challengeId ? certificate.error : description, url2);
      this.changed(page.taskId);
      this.scheduleRecovery(page);
    });
    let gesture = 0, burstAt = 0, burst = 0;
    wc.on("before-mouse-event", (_event, input) => {
      if (input.type === "mouseDown") gesture = Date.now();
    });
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      gesture = Date.now();
      if (!(input.meta || input.control) || input.alt) return;
      const key = input.key.toLowerCase(), action = key === "b" && input.shift ? "new" : key === "r" ? input.shift ? "hard-reload" : "reload" : key === "w" ? "close" : key === "t" ? input.shift ? "reopen" : "new" : key === "f" ? "find" : key === "l" ? "address" : key === "[" ? "back" : key === "]" ? "forward" : void 0;
      if (action) {
        event.preventDefault();
        this.options.shortcut?.(page.taskId, action);
      }
    });
    const external = (event, url2) => {
      try {
        const protocol = new URL(url2).protocol;
        if (!["http:", "https:", "file:", "about:", "javascript:", "data:"].includes(protocol)) {
          event.preventDefault();
          this.external.set(page.taskId, { id: node_crypto.randomUUID(), url: url2 });
          this.changed(page.taskId);
        }
      } catch {
        event.preventDefault();
      }
    };
    wc.on("will-navigate", external);
    wc.on("will-redirect", external);
    wc.setWindowOpenHandler((details) => {
      if (page.importPaused) return { action: "deny" };
      const url2 = normalizeBrowserNavigationUrl(details.url);
      if (!url2) {
        try {
          external({ preventDefault() {
          } }, details.url);
        } catch {
        }
        return { action: "deny" };
      }
      const now = Date.now(), userGesture = now - gesture <= 500;
      gesture = 0;
      if (now - burstAt > 1e3) {
        burstAt = now;
        burst = 0;
      }
      if (!userGesture && ++burst > 5) {
        this.notices.set(page.taskId, "页面打开了过多新标签，已阻止后续弹窗");
        this.changed(page.taskId);
        return { action: "deny" };
      }
      if (url2.startsWith("file:") && !wc.getURL().startsWith("file:")) return { action: "deny" };
      if (details.frameName && details.frameName !== "_blank") return { action: "allow", createWindow: (options) => this.options.pages.createPopup(page, options) };
      return { action: "allow", outlivesOpener: true, createWindow: (options) => this.options.pages.createPopup(page, options, true) };
    });
    update();
  }
  remember(taskId, url2, title) {
    const state2 = this.snapshot(taskId), recent = browserRecentVisit(state2.recent, url2, title, Date.now());
    if (recent !== state2.recent) this.saveRecent(state2.projectId, recent);
  }
  saveRecent(projectId, recent) {
    this.options.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run("browserRecent.v1:" + projectId, JSON.stringify(recent), Date.now());
    for (const id2 of this.tasks.keys()) if (this.options.taskProject(id2) === projectId) this.changed(id2);
  }
  reconcile() {
    if (this.reconciling) return this.reconciling;
    this.reconciling = (async () => {
      const rows = this.options.sqlite.prepare("SELECT key FROM app_settings WHERE key LIKE ?").all("browserWorkspace.v1:%");
      const taskIds = /* @__PURE__ */ new Set([...this.tasks.keys(), ...rows.map((row) => row.key.slice("browserWorkspace.v1:".length))]);
      for (const taskId of taskIds) if (!this.options.taskProject(taskId)) {
        for (const page of this.options.pages.list(taskId)) if (this.options.pages.list(taskId).some((p) => p.id === page.id)) {
          this.cancelRecovery(page.id);
          await this.options.pages.close(taskId, page.id);
          this.runtime.delete(page.id);
        }
        this.tasks.delete(taskId);
        this.external.delete(taskId);
        this.notices.delete(taskId);
        this.options.sqlite.prepare("DELETE FROM app_settings WHERE key=?").run(this.key(taskId));
        this.changed(taskId);
      }
    })().finally(() => {
      this.reconciling = void 0;
    });
    return this.reconciling;
  }
  async dispose() {
    this.shuttingDown = true;
    this.unobserve();
    for (const id2 of this.recovering.keys()) this.cancelRecovery(id2);
    await this.reconciling;
  }
}
const browserCommands = /* @__PURE__ */ JSON.parse('[{"id":"browser.identity.get","command":["browser","identity","get"],"semantics":"read","input":{"type":"object","properties":{},"required":[],"additionalProperties":false},"usage":"willyou-app browser identity get","cases":["M12-T089"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.identity.set","command":["browser","identity","set"],"semantics":"write","input":{"type":"object","properties":{"mode":{"type":"string","enum":["clean","native"]},"reset":{"type":"boolean"}},"required":["mode"],"additionalProperties":false},"usage":"willyou-app browser identity set --mode <clean|native> [--reset true]","cases":["M12-T089"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.nav.snapshot","command":["browser","snapshot"],"semantics":"read","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser snapshot [--task <任务ID>] [--page <页面ID>]","cases":["M12-T050","M12-T051"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"origin":{"type":"string"},"snapshot":{"type":"string"},"refs":{"type":"array","items":{"type":"object","properties":{"ref":{"type":"string"},"role":{"type":"string"},"name":{"type":"string"},"available":{"type":"boolean"}},"required":["ref","role","name"],"additionalProperties":false}},"browserPageId":{"type":"string"},"url":{"type":"string"},"title":{"type":"string"}},"required":["snapshot","refs","browserPageId","url","title"],"additionalProperties":false}]}},{"id":"browser.nav.screenshot","command":["browser","screenshot"],"semantics":"read","input":{"type":"object","properties":{"format":{"enum":["png","jpeg"]},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser screenshot [--format <png|jpeg>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T054"],"output":{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"format":{"enum":["png","jpeg"]},"width":{"type":"integer","minimum":0},"height":{"type":"integer","minimum":0}},"required":["file","format","width","height"],"additionalProperties":false}},{"id":"browser.nav.goto","command":["browser","goto"],"semantics":"write","input":{"type":"object","properties":{"url":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["url"],"additionalProperties":false},"usage":"willyou-app browser goto --url <url> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T072"],"output":{"type":"object","properties":{"navigated":{"const":true}},"required":["navigated"],"additionalProperties":false}},{"id":"browser.nav.back","command":["browser","back"],"semantics":"write","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser back [--task <任务ID>] [--page <页面ID>]","cases":["M12-T072"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.nav.reload","command":["browser","reload"],"semantics":"write","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser reload [--task <任务ID>] [--page <页面ID>]","cases":["M12-T072"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.nav.forward","command":["browser","forward"],"semantics":"write","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser forward [--task <任务ID>] [--page <页面ID>]","cases":["M12-T072"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.eval","command":["browser","eval"],"semantics":"write","input":{"type":"object","properties":{"expression":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["expression"],"additionalProperties":false},"usage":"willyou-app browser eval --expression <js> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T057"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"value":{"type":"string"},"origin":{"type":"string"}},"required":["value","origin"],"additionalProperties":false}]}},{"id":"browser.nav.scroll","command":["browser","scroll"],"semantics":"write","input":{"type":"object","properties":{"direction":{"type":"string","enum":["up","down"]},"amount":{"type":"number","minimum":0},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["direction"],"additionalProperties":false},"usage":"willyou-app browser scroll --direction <up|down> [--amount <pixels>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T061"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.nav.wait","command":["browser","wait"],"semantics":"read","input":{"type":"object","properties":{"selector":{"type":["string","number","boolean"],"maxLength":262144},"timeout":{"type":"integer","minimum":1,"maximum":90000},"text":{"type":["string","number","boolean"],"maxLength":262144},"url":{"type":["string","number","boolean"],"maxLength":262144},"load":{"enum":["load","domcontentloaded","networkidle"]},"state":{"enum":["hidden","visible"]},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser wait [--selector <sel>] [--timeout <ms>] [--text <text>] [--url <pattern>] [--load <state>] [--state <hidden|visible>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T036","M12-T066"],"output":{"type":"object","properties":{"waited":{"const":true}},"required":["waited"],"additionalProperties":false}},{"id":"browser.nav.pdf","command":["browser","pdf"],"semantics":"read","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser pdf [--task <任务ID>] [--page <页面ID>]","cases":["M12-T056"],"output":{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false}},"required":["file"],"additionalProperties":false}},{"id":"browser.nav.full-screenshot","command":["browser","full-screenshot"],"semantics":"read","input":{"type":"object","properties":{"format":{"enum":["png","jpeg"]},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser full-screenshot [--format <png|jpeg>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T055"],"output":{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"format":{"enum":["png","jpeg"]},"width":{"type":"integer","minimum":0},"height":{"type":"integer","minimum":0}},"required":["file","format","width","height"],"additionalProperties":false}},{"id":"browser.interact.click","command":["browser","click"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element"],"additionalProperties":false},"usage":"willyou-app browser click --element <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T061"],"output":{"type":"object","properties":{"clicked":{"type":"string"},"path":{"const":"cdp"},"newTab":{"type":"boolean"},"url":{"type":"string"},"dialogOpened":{"type":"boolean"}},"required":["clicked"],"additionalProperties":false}},{"id":"browser.interact.dblclick","command":["browser","dblclick"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element"],"additionalProperties":false},"usage":"willyou-app browser dblclick --element <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T061"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.fill","command":["browser","fill"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"value":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element","value"],"additionalProperties":false},"usage":"willyou-app browser fill --element <ref> --value <text> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T063","M12-T064"],"output":{"type":"object","properties":{"filled":{"type":"string"}},"required":["filled"],"additionalProperties":false}},{"id":"browser.interact.type","command":["browser","type"],"semantics":"write","input":{"type":"object","properties":{"input":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["input"],"additionalProperties":false},"usage":"willyou-app browser type --input <text> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T060","M12-T063"],"output":{"type":"object","properties":{"typed":{"const":true},"progress":{"type":"object","properties":{"confirmedChars":{"type":"integer","minimum":0},"inFlight":{"type":"object","properties":{"offset":{"type":"integer","minimum":0},"length":{"type":"integer","minimum":0}},"required":["offset","length"],"additionalProperties":false},"observed":{"type":"object","properties":{"at":{"type":"string"},"length":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["at","length","sha256"],"additionalProperties":false}},"required":["confirmedChars"],"additionalProperties":false}},"required":["typed","progress"],"additionalProperties":false}},{"id":"browser.interact.select","command":["browser","select"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"value":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element","value"],"additionalProperties":false},"usage":"willyou-app browser select --element <ref> --value <value> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T063"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.check","command":["browser","check"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element"],"additionalProperties":false},"usage":"willyou-app browser check --element <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T063"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.uncheck","command":["browser","uncheck"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element"],"additionalProperties":false},"usage":"willyou-app browser uncheck --element <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T063"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.focus","command":["browser","focus"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element"],"additionalProperties":false},"usage":"willyou-app browser focus --element <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T063"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.clear","command":["browser","clear"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element"],"additionalProperties":false},"usage":"willyou-app browser clear --element <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T063"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.select-all","command":["browser","select-all"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element"],"additionalProperties":false},"usage":"willyou-app browser select-all --element <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T063"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.keypress","command":["browser","keypress"],"semantics":"write","input":{"type":"object","properties":{"key":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["key"],"additionalProperties":false},"usage":"willyou-app browser keypress --key <name> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T063"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.hover","command":["browser","hover"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element"],"additionalProperties":false},"usage":"willyou-app browser hover --element <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T061"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.drag","command":["browser","drag"],"semantics":"write","input":{"type":"object","properties":{"from":{"type":["string","number","boolean"],"maxLength":262144},"to":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["from","to"],"additionalProperties":false},"usage":"willyou-app browser drag --from <ref> --to <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T061"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.upload","command":["browser","upload"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"files":{"anyOf":[{"type":["string","number","boolean"],"maxLength":262144},{"type":"array","minItems":1,"items":{"type":"string"}}]},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element","files"],"additionalProperties":false},"usage":"willyou-app browser upload --element <ref> --files <path,...> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T067"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.scrollintoview","command":["browser","scrollintoview"],"semantics":"write","input":{"type":"object","properties":{"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["element"],"additionalProperties":false},"usage":"willyou-app browser scrollintoview --element <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T061"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.get","command":["browser","get"],"semantics":"read","input":{"type":"object","properties":{"what":{"enum":["text","html","value","url","title","count","box"]},"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["what"],"additionalProperties":false},"usage":"willyou-app browser get --what <property> [--element <ref>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T058"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{"anyOf":[{"type":"string"},{"type":"number"},{"type":"boolean"},{"type":"null"},{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"width":{"type":"number"},"height":{"type":"number"}},"required":["x","y","width","height"],"additionalProperties":false}]}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.is","command":["browser","is"],"semantics":"read","input":{"type":"object","properties":{"what":{"enum":["visible","enabled","checked"]},"element":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["what","element"],"additionalProperties":false},"usage":"willyou-app browser is --what <state> --element <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T058"],"output":{"type":"object","properties":{"result":{"type":"boolean"}},"required":["result"],"additionalProperties":false}},{"id":"browser.interact.inserttext","command":["browser","inserttext"],"semantics":"write","input":{"type":"object","properties":{"text":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["text"],"additionalProperties":false},"usage":"willyou-app browser inserttext --text <text> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T063"],"output":{"type":"object","properties":{"typed":{"const":true},"progress":{"type":"object","properties":{"confirmedChars":{"type":"integer","minimum":0},"inFlight":{"type":"object","properties":{"offset":{"type":"integer","minimum":0},"length":{"type":"integer","minimum":0}},"required":["offset","length"],"additionalProperties":false},"observed":{"type":"object","properties":{"at":{"type":"string"},"length":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["at","length","sha256"],"additionalProperties":false}},"required":["confirmedChars"],"additionalProperties":false}},"required":["typed","progress"],"additionalProperties":false}},{"id":"browser.interact.mouse-move","command":["browser","mouse","move"],"semantics":"write","input":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["x","y"],"additionalProperties":false},"usage":"willyou-app browser mouse move --x <n> --y <n> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T062"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.mouse-down","command":["browser","mouse","down"],"semantics":"write","input":{"type":"object","properties":{"button":{"type":"string","enum":["left","right","middle"]},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser mouse down [--button <left|right|middle>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T062"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.mouse-up","command":["browser","mouse","up"],"semantics":"write","input":{"type":"object","properties":{"button":{"type":"string","enum":["left","right","middle"]},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser mouse up [--button <left|right|middle>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T062"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.mouse-wheel","command":["browser","mouse","wheel"],"semantics":"write","input":{"type":"object","properties":{"dy":{"type":"number"},"dx":{"type":"number"},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["dy"],"additionalProperties":false},"usage":"willyou-app browser mouse wheel --dy <n> [--dx <n>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T062"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.find","command":["browser","find"],"semantics":"write","input":{"type":"object","properties":{"locator":{"enum":["role","text","label","placeholder","alt","title","testid","first","last","nth"]},"value":{"type":["string","number","boolean"],"maxLength":262144},"action":{"enum":["click","fill","type","hover","focus","check","uncheck"]},"text":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144},"name":{"type":["string","number","boolean"],"maxLength":262144},"exact":{"type":"boolean"}},"required":["locator","value","action"],"additionalProperties":false},"usage":"willyou-app browser find --locator <type> --value <text> --action <action> [--text <text>] [--task <任务ID>] [--page <页面ID>] [--name <名称>] [--exact true]","cases":["M12-T065"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.download","command":["browser","download"],"semantics":"write","input":{"type":"object","properties":{"selector":{"type":["string","number","boolean"],"maxLength":262144},"path":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["selector","path"],"additionalProperties":false},"usage":"willyou-app browser download --selector <ref> --path <path> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T067"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.interact.highlight","command":["browser","highlight"],"semantics":"write","input":{"type":"object","properties":{"selector":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["selector"],"additionalProperties":false},"usage":"willyou-app browser highlight --selector <ref> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T061"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.tab.list","command":["browser","tab","list"],"semantics":"read","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"show-profile":{"type":"boolean"}},"required":[],"additionalProperties":false},"usage":"willyou-app browser tab list [--task <任务ID>] [--show-profile true]","cases":["M12-T034","M12-T073"],"output":{"type":"object","properties":{"tabs":{"type":"array","items":{"anyOf":[{"type":"object","properties":{"pageId":{"type":"string"},"browserPageId":{"type":"string"},"index":{"type":"integer","minimum":0},"active":{"type":"boolean"},"title":{"type":"string"},"url":{"type":"string"},"profileId":{"type":"string"},"kind":{"const":"tab"}},"required":["pageId","browserPageId","index","active","title","url","profileId","kind"],"additionalProperties":false},{"type":"object","properties":{"pageId":{"type":"string"},"browserPageId":{"type":"string"},"index":{"type":"integer","minimum":0},"active":{"type":"boolean"},"title":{"type":"string"},"url":{"type":"string"},"profileId":{"type":"string"},"kind":{"const":"popup"},"openerPageId":{"type":"string"}},"required":["pageId","browserPageId","index","active","title","url","profileId","kind","openerPageId"],"additionalProperties":false}]}}},"required":["tabs"],"additionalProperties":false}},{"id":"browser.tab.show","command":["browser","tab","show"],"semantics":"read","input":{"type":"object","properties":{"page":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144}},"required":["page"],"additionalProperties":false},"usage":"willyou-app browser tab show --page <id> [--task <任务ID>]","cases":["M12-T073"],"output":{"type":"object","properties":{"result":{"anyOf":[{"type":"object","properties":{"pageId":{"type":"string"},"browserPageId":{"type":"string"},"index":{"type":"integer","minimum":0},"active":{"type":"boolean"},"title":{"type":"string"},"url":{"type":"string"},"profileId":{"type":"string"},"kind":{"const":"tab"}},"required":["pageId","browserPageId","index","active","title","url","profileId","kind"],"additionalProperties":false},{"type":"object","properties":{"pageId":{"type":"string"},"browserPageId":{"type":"string"},"index":{"type":"integer","minimum":0},"active":{"type":"boolean"},"title":{"type":"string"},"url":{"type":"string"},"profileId":{"type":"string"},"kind":{"const":"popup"},"openerPageId":{"type":"string"}},"required":["pageId","browserPageId","index","active","title","url","profileId","kind","openerPageId"],"additionalProperties":false}]}},"required":["result"],"additionalProperties":false}},{"id":"browser.tab.current","command":["browser","tab","current"],"semantics":"read","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser tab current [--task <任务ID>]","cases":["M12-T073"],"output":{"type":"object","properties":{"result":{"anyOf":[{"type":"object","properties":{"pageId":{"type":"string"},"browserPageId":{"type":"string"},"index":{"type":"integer","minimum":0},"active":{"type":"boolean"},"title":{"type":"string"},"url":{"type":"string"},"profileId":{"type":"string"},"kind":{"const":"tab"}},"required":["pageId","browserPageId","index","active","title","url","profileId","kind"],"additionalProperties":false},{"type":"object","properties":{"pageId":{"type":"string"},"browserPageId":{"type":"string"},"index":{"type":"integer","minimum":0},"active":{"type":"boolean"},"title":{"type":"string"},"url":{"type":"string"},"profileId":{"type":"string"},"kind":{"const":"popup"},"openerPageId":{"type":"string"}},"required":["pageId","browserPageId","index","active","title","url","profileId","kind","openerPageId"],"additionalProperties":false}]}},"required":["result"],"additionalProperties":false}},{"id":"browser.tab.switch","command":["browser","tab","switch"],"semantics":"write","input":{"type":"object","properties":{"index":{"type":"integer","minimum":0},"page":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"focus":{"type":"boolean"}},"required":[],"additionalProperties":false},"usage":"willyou-app browser tab switch (--index <n> | --page <id>) [--task <任务ID>] [--focus true]","cases":["M12-T073","M12-T115"],"output":{"type":"object","properties":{"result":{"type":"object","properties":{"pageId":{"type":"string"},"url":{"type":"string"}},"required":["pageId","url"],"additionalProperties":false}},"required":["result"],"additionalProperties":false}},{"id":"browser.tab.create","command":["browser","tab","create"],"semantics":"write","input":{"type":"object","properties":{"url":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"profile":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser tab create [--url <url>] [--task <任务ID>] [--profile <id>]","cases":["M12-T073","M12-T105"],"output":{"type":"object","properties":{"pageId":{"type":"string"},"url":{"type":"string"}},"required":["pageId","url"],"additionalProperties":false}},{"id":"browser.tab.close","command":["browser","tab","close"],"semantics":"write","input":{"type":"object","properties":{"index":{"type":"integer","minimum":0},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser tab close [--index <n>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T073"],"output":{"type":"object","properties":{"result":{"type":"object","properties":{"closed":{"type":"string"}},"required":["closed"],"additionalProperties":false}},"required":["result"],"additionalProperties":false}},{"id":"browser.interact.exec","command":["browser","exec"],"semantics":"write","input":{"type":"object","properties":{"command":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["command"],"additionalProperties":false},"usage":"willyou-app browser exec --command \\"<agent-browser command>\\" [--task <任务ID>] [--page <页面ID>]","cases":["M12-T039"],"output":{}},{"id":"browser.profile.list","command":["browser","tab","profile","list"],"semantics":"read","input":{"type":"object","properties":{},"required":[],"additionalProperties":false},"usage":"willyou-app browser tab profile list","cases":["M12-T075"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.profile.create","command":["browser","tab","profile","create"],"semantics":"write","input":{"type":"object","properties":{"label":{"type":["string","number","boolean"],"maxLength":262144},"scope":{"type":"string","enum":["isolated","imported"]}},"required":["label"],"additionalProperties":false},"usage":"willyou-app browser tab profile create --label <name> [--scope <isolated|imported>]","cases":["M12-T075","M12-T077"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.profile.delete","command":["browser","tab","profile","delete"],"semantics":"write","input":{"type":"object","properties":{"profile":{"type":["string","number","boolean"],"maxLength":262144}},"required":["profile"],"additionalProperties":false},"usage":"willyou-app browser tab profile delete --profile <id>","cases":["M12-T075","M12-T079"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.profile.set","command":["browser","tab","profile","set"],"semantics":"write","input":{"type":"object","properties":{"page":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"profile":{"type":["string","number","boolean"],"maxLength":262144}},"required":["profile"],"additionalProperties":false},"usage":"willyou-app browser tab profile set (--page <id> | --task <任务ID>) --profile <id>","cases":["M12-T075"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.profile.show","command":["browser","tab","profile","show"],"semantics":"read","input":{"type":"object","properties":{"page":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144}},"required":["page"],"additionalProperties":false},"usage":"willyou-app browser tab profile show --page <id> [--task <任务ID>]","cases":["M12-T075"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.profile.use-default","command":["browser","tab","profile","use-default"],"semantics":"write","input":{"type":"object","properties":{"page":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144}},"required":["page"],"additionalProperties":false},"usage":"willyou-app browser tab profile use-default --page <id> [--task <任务ID>]","cases":["M12-T075"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.profile.clone","command":["browser","tab","profile","clone"],"semantics":"write","input":{"type":"object","properties":{"profile":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144}},"required":["profile"],"additionalProperties":false},"usage":"willyou-app browser tab profile clone --profile <id> [--page <id>] [--task <任务ID>]","cases":["M12-T075"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.cookie.get","command":["browser","cookie","get"],"semantics":"read","input":{"type":"object","properties":{"url":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser cookie get [--url <url>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T084"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.cookie.set","command":["browser","cookie","set"],"semantics":"write","input":{"type":"object","properties":{"name":{"type":["string","number","boolean"],"maxLength":262144},"value":{"type":["string","number","boolean"],"maxLength":262144},"domain":{"type":["string","number","boolean"],"maxLength":262144},"path":{"type":["string","number","boolean"],"maxLength":262144},"secure":{"type":"boolean"},"httpOnly":{"type":"boolean"},"sameSite":{"type":["string","number","boolean"],"maxLength":262144},"expires":{"type":"number"},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["name","value"],"additionalProperties":false},"usage":"willyou-app browser cookie set --name <n> --value <v> [--domain <d>] [--path <p>] [--secure true] [--httpOnly true] [--sameSite <s>] [--expires <epoch>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T084"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.cookie.delete","command":["browser","cookie","delete"],"semantics":"write","input":{"type":"object","properties":{"name":{"type":["string","number","boolean"],"maxLength":262144},"domain":{"type":["string","number","boolean"],"maxLength":262144},"url":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["name"],"additionalProperties":false},"usage":"willyou-app browser cookie delete --name <n> [--domain <d>] [--url <u>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T084"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.capture.intercept-enable","command":["browser","intercept","enable"],"semantics":"write","input":{"type":"object","properties":{"patterns":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser intercept enable [--patterns <glob,...>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T071"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.capture.intercept-disable","command":["browser","intercept","disable"],"semantics":"write","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser intercept disable [--task <任务ID>] [--page <页面ID>]","cases":["M12-T071"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.capture.intercept-list","command":["browser","intercept","list"],"semantics":"read","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser intercept list [--task <任务ID>] [--page <页面ID>]","cases":["M12-T071"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.capture.start","command":["browser","capture","start"],"semantics":"write","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser capture start [--task <任务ID>] [--page <页面ID>]","cases":["M12-T070"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.capture.stop","command":["browser","capture","stop"],"semantics":"write","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser capture stop [--task <任务ID>] [--page <页面ID>]","cases":["M12-T070"],"output":{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false}},"required":["file"],"additionalProperties":false}},{"id":"browser.nav.console","command":["browser","console"],"semantics":"read","input":{"type":"object","properties":{"limit":{"type":"integer","minimum":1},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser console [--limit <n>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T069"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"messages":{"type":"array","items":{"type":"object","properties":{"type":{"type":"string"},"text":{"type":"string"},"args":{"type":"array","items":{}}},"required":["type","text"],"additionalProperties":false}}},"required":["messages"],"additionalProperties":false}]}},{"id":"browser.nav.network","command":["browser","network"],"semantics":"read","input":{"type":"object","properties":{"limit":{"type":"integer","minimum":1},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser network [--limit <n>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T069"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"requests":{"type":"array","items":{"type":"object"}}},"required":["requests"],"additionalProperties":false}]}},{"id":"browser.env.viewport","command":["browser","viewport"],"semantics":"write","input":{"type":"object","properties":{"width":{"type":"integer","minimum":1,"maximum":32768},"height":{"type":"integer","minimum":1,"maximum":32768},"scale":{"type":"number","exclusiveMinimum":0,"maximum":10},"mobile":{"type":"boolean"},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["width","height"],"additionalProperties":false},"usage":"willyou-app browser viewport --width <w> --height <h> [--scale <n>] [--mobile true] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T086"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.env.geolocation","command":["browser","geolocation"],"semantics":"write","input":{"type":"object","properties":{"latitude":{"type":"number","minimum":-90,"maximum":90},"longitude":{"type":"number","minimum":-180,"maximum":180},"accuracy":{"type":"number","minimum":0},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["latitude","longitude"],"additionalProperties":false},"usage":"willyou-app browser geolocation --latitude <lat> --longitude <lon> [--accuracy <n>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T086"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.env.set-device","command":["browser","set","device"],"semantics":"write","input":{"type":"object","properties":{"name":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["name"],"additionalProperties":false},"usage":"willyou-app browser set device --name <device> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T086"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.env.set-offline","command":["browser","set","offline"],"semantics":"write","input":{"type":"object","properties":{"state":{"enum":["on","off"]},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser set offline [--state <on|off>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T086"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.env.set-headers","command":["browser","set","headers"],"semantics":"write","input":{"type":"object","properties":{"headers":{"type":"object","additionalProperties":{"type":"string"}},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["headers"],"additionalProperties":false},"usage":"willyou-app browser set headers --headers <json> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T086"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.env.set-credentials","command":["browser","set","credentials"],"semantics":"write","input":{"type":"object","properties":{"user":{"type":["string","number","boolean"],"maxLength":262144},"pass":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["user","pass"],"additionalProperties":false},"usage":"willyou-app browser set credentials --user <user> --pass <pass> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T087"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.env.set-media","command":["browser","set","media"],"semantics":"write","input":{"type":"object","properties":{"color-scheme":{"type":"string","enum":["dark","light"]},"reduced-motion":{"type":"string","enum":["reduce","no-preference"]},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser set media [--color-scheme <dark|light>] [--reduced-motion <reduce|no-preference>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T086"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.env.clipboard-read","command":["browser","clipboard","read"],"semantics":"read","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser clipboard read [--task <任务ID>] [--page <页面ID>]","cases":["M12-T088"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.env.clipboard-write","command":["browser","clipboard","write"],"semantics":"write","input":{"type":"object","properties":{"text":{"type":["string","number","boolean"],"maxLength":16777216},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["text"],"additionalProperties":false},"usage":"willyou-app browser clipboard write --text <text> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T088"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.env.dialog-accept","command":["browser","dialog","accept"],"semantics":"write","input":{"type":"object","properties":{"text":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser dialog accept [--text <text>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T068"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.env.dialog-dismiss","command":["browser","dialog","dismiss"],"semantics":"write","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser dialog dismiss [--task <任务ID>] [--page <页面ID>]","cases":["M12-T068"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.storage.local-get","command":["browser","storage","local","get"],"semantics":"read","input":{"type":"object","properties":{"key":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["key"],"additionalProperties":false},"usage":"willyou-app browser storage local get --key <key> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T085"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.storage.local-set","command":["browser","storage","local","set"],"semantics":"write","input":{"type":"object","properties":{"key":{"type":["string","number","boolean"],"maxLength":262144},"value":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["key","value"],"additionalProperties":false},"usage":"willyou-app browser storage local set --key <key> --value <value> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T085"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.storage.local-clear","command":["browser","storage","local","clear"],"semantics":"write","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser storage local clear [--task <任务ID>] [--page <页面ID>]","cases":["M12-T085"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.storage.session-get","command":["browser","storage","session","get"],"semantics":"read","input":{"type":"object","properties":{"key":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["key"],"additionalProperties":false},"usage":"willyou-app browser storage session get --key <key> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T085"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.storage.session-set","command":["browser","storage","session","set"],"semantics":"write","input":{"type":"object","properties":{"key":{"type":["string","number","boolean"],"maxLength":262144},"value":{"type":["string","number","boolean"],"maxLength":262144},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["key","value"],"additionalProperties":false},"usage":"willyou-app browser storage session set --key <key> --value <value> [--task <任务ID>] [--page <页面ID>]","cases":["M12-T085"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.storage.session-clear","command":["browser","storage","session","clear"],"semantics":"write","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":[],"additionalProperties":false},"usage":"willyou-app browser storage session clear [--task <任务ID>] [--page <页面ID>]","cases":["M12-T085"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.nav.wait-fn","command":["browser","wait","fn"],"semantics":"write","input":{"type":"object","properties":{"fn":{"type":["string","number","boolean"],"maxLength":262144},"timeout":{"type":"integer","minimum":1,"maximum":90000},"task":{"type":["string","number","boolean"],"maxLength":262144},"page":{"type":["string","number","boolean"],"maxLength":262144}},"required":["fn"],"additionalProperties":false},"usage":"willyou-app browser wait fn --fn <js> [--timeout <ms>] [--task <任务ID>] [--page <页面ID>]","cases":["M12-T066","M12-T095"],"output":{"type":"object","properties":{"waited":{"const":true}},"required":["waited"],"additionalProperties":false}},{"id":"browser.access.request","command":["browser","access","request"],"semantics":"write","input":{"type":"object","properties":{"task":{"type":["string","number","boolean"],"maxLength":262144},"mode":{"type":"string","enum":["observe","control"]}},"required":["task","mode"],"additionalProperties":false},"usage":"willyou-app browser access request --task <任务ID> --mode <observe|control>","cases":["M12-T095","M12-T096"],"output":{"anyOf":[{"type":"object","properties":{"file":{"type":"object","properties":{"path":{"type":"string"},"bytes":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["path","bytes","sha256"],"additionalProperties":false},"truncatedPreview":{"type":"string","maxLength":4096}},"required":["file","truncatedPreview"],"additionalProperties":false},{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}]}},{"id":"browser.operation.get","command":["browser","operation","get"],"semantics":"read","input":{"type":"object","properties":{"request":{"type":["string","number","boolean"],"maxLength":262144}},"required":["request"],"additionalProperties":false},"usage":"willyou-app browser operation get --request <requestId>","cases":["M12-T037","M12-T094"],"output":{"anyOf":[{"type":"object","properties":{"state":{"const":"not-found"}},"required":["state"],"additionalProperties":false},{"type":"object","properties":{"requestId":{"type":"string"},"pageId":{"anyOf":[{"type":"string"},{"type":"null"}]},"command":{"type":"string"},"state":{"enum":["succeeded","failed","unknown"]},"effectState":{"enum":["completed","not-started","unknown"]},"progress":{"anyOf":[{"type":"object","properties":{"confirmedChars":{"type":"integer","minimum":0},"inFlight":{"type":"object","properties":{"offset":{"type":"integer","minimum":0},"length":{"type":"integer","minimum":0}},"required":["offset","length"],"additionalProperties":false},"observed":{"type":"object","properties":{"at":{"type":"string"},"length":{"type":"integer","minimum":0},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["at","length","sha256"],"additionalProperties":false}},"required":["confirmedChars"],"additionalProperties":false},{"type":"null"}]},"summary":{},"errorCode":{"anyOf":[{"type":"string"},{"type":"null"}]},"createdAt":{"type":"integer","minimum":0},"updatedAt":{"type":"integer","minimum":0}},"required":["requestId","pageId","command","state","effectState","progress","summary","errorCode","createdAt","updatedAt"],"additionalProperties":false}]}}]');
const text$3 = (value) => {
  if (!["string", "number", "boolean"].includes(typeof value)) throw new ApplicationError("INVALID_INPUT", "文本字段只接受字符串、数字或布尔值");
  return String(value);
};
const finite = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApplicationError("INVALID_INPUT", "坐标或尺寸必须为有限数字");
  return value;
};
function browserPageArguments(command, args) {
  if (["dblclick", "hover", "focus", "scrollintoview"].includes(command)) return [command, text$3(args.element)];
  if (command === "highlight") return ["highlight", text$3(args.selector)];
  if (command === "drag") return ["drag", text$3(args.from), text$3(args.to)];
  if (command === "upload") {
    const files = Array.isArray(args.files) ? args.files.map(text$3) : text$3(args.files).split(",");
    if (!files.length || files.some((file) => !file)) throw new ApplicationError("INVALID_INPUT", "上传路径不能为空");
    return ["upload", text$3(args.element), ...files];
  }
  if (command === "keypress") return ["press", text$3(args.key)];
  if (command === "scroll") return ["scroll", text$3(args.direction), String(args.amount ?? 500)];
  if (command === "mouse move") return ["mouse", "move", String(finite(args.x)), String(finite(args.y))];
  if (command === "mouse down" || command === "mouse up") return ["mouse", command.split(" ")[1], text$3(args.button ?? "left")];
  if (command === "mouse wheel") return ["mouse", "wheel", String(finite(args.dy)), String(finite(args.dx ?? 0))];
  if (command === "find") {
    const locator = text$3(args.locator), value = text$3(args.value), action = text$3(args.action), payload = args.text === void 0 ? [] : [text$3(args.text)];
    if (!["click", "fill", "type", "hover", "focus", "check", "uncheck"].includes(action)) throw new ApplicationError("INVALID_INPUT", "find action必须为已列出的页面动作");
    if (locator === "nth") {
      const match = /^(0|[1-9]\d*)\s+([\s\S]+)$/.exec(value.trim());
      if (!match || !Number.isSafeInteger(Number(match[1]))) throw new ApplicationError("INVALID_INPUT", "nth的value须为“零基索引 CSS选择器”，例如“1 button”");
      if (args.name !== void 0 || args.exact === true) throw new ApplicationError("INVALID_INPUT", "nth不接受name/exact选项");
      return ["find", "nth", match[1], match[2], action, ...payload];
    }
    return ["find", locator, value, action, ...payload, ...args.name === void 0 ? [] : ["--name", text$3(args.name)], ...args.exact === true ? ["--exact"] : []];
  }
  if (command === "wait fn") return ["wait", "--fn", text$3(args.fn), "--timeout", String(args.timeout ?? 25e3)];
  if (command === "set device") return ["set", "device", text$3(args.name)];
  if (command === "set media") {
    if (args["reduced-motion"] !== void 0 && args["reduced-motion"] !== "reduce" && args["reduced-motion"] !== "no-preference") throw new ApplicationError("INVALID_INPUT", "reduced-motion须为reduce或no-preference");
    return ["set", "media", ...args["color-scheme"] === void 0 ? [] : [text$3(args["color-scheme"])], ...args["reduced-motion"] === "reduce" ? ["reduced-motion"] : []];
  }
  if (command === "clipboard read") return ["clipboard", "read"];
  if (command === "clipboard write") return ["clipboard", "write", text$3(args.text)];
  if (command === "dialog accept") return ["dialog", "accept", ...args.text === void 0 ? [] : [text$3(args.text)]];
  if (command === "dialog dismiss") return ["dialog", "dismiss"];
  if (/^storage (local|session) (get|set|clear)$/.test(command)) return [...command.split(" "), ...command.endsWith(" clear") ? [] : [text$3(args.key)], ...command.endsWith(" set") ? [text$3(args.value)] : []];
  return null;
}
async function executeBrowserPageCommand(page, command, args, context) {
  const { signal, send, notStarted } = context;
  if (command === "viewport") {
    const width = finite(args.width), height = finite(args.height), deviceScaleFactor = finite(args.scale ?? 1), mobile = args.mobile === true;
    if (width <= 0 || height <= 0 || deviceScaleFactor <= 0) throw new ApplicationError("INVALID_INPUT", "视口宽高和缩放必须大于零");
    send();
    await page.proxy.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile });
    await page.proxy.send("Emulation.setVisibleSize", { width, height });
    return { handled: true, result: { result: { width, height, deviceScaleFactor, mobile } } };
  }
  if (command === "geolocation") {
    const latitude = finite(args.latitude), longitude = finite(args.longitude), accuracy = finite(args.accuracy ?? 1);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) throw new ApplicationError("INVALID_INPUT", "地理位置范围无效");
    send();
    await page.proxy.send("Emulation.setGeolocationOverride", { latitude, longitude, accuracy });
    return { handled: true, result: { result: { latitude, longitude, accuracy } } };
  }
  if (command === "set headers") {
    if (!args.headers || typeof args.headers !== "object" || Array.isArray(args.headers) || Object.values(args.headers).some((value) => typeof value !== "string")) throw new ApplicationError("INVALID_INPUT", "headers必须为字符串值对象");
    send();
    await page.proxy.send("Network.enable");
    await page.proxy.send("Network.setExtraHTTPHeaders", { headers: args.headers });
    return { handled: true, result: { result: { headersSet: true } } };
  }
  if (command === "set offline") {
    const offline = (args.state ?? "on") === "on";
    if (args.state !== void 0 && args.state !== "on" && args.state !== "off") throw new ApplicationError("INVALID_INPUT", "offline state必须为on或off");
    send();
    await page.proxy.send("Network.enable");
    await page.proxy.send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    return { handled: true, result: { result: { offline } } };
  }
  if (command === "get" && (args.what === "url" || args.what === "title")) return { handled: true, result: { result: args.what === "url" ? page.contents.getURL() : page.contents.getTitle() } };
  const native = browserPageArguments(command, args), referenceKeys = command === "drag" ? ["from", "to"] : command === "highlight" ? ["selector"] : ["get", "is", "select", "check", "uncheck", "clear", "select-all", "dblclick", "hover", "focus", "scrollintoview", "upload"].includes(command) ? ["element"] : [];
  if (!native && !["get", "is", "select", "check", "uncheck", "clear", "select-all"].includes(command)) return { handled: false };
  const held = /* @__PURE__ */ new Map();
  let result, error2;
  try {
    for (const key of referenceKeys) {
      const ref2 = text$3(args[key]);
      if (!held.has(ref2)) held.set(ref2, await page.references.arm(ref2, { append: held.size > 0, locator: command !== "get" && command !== "is" }));
    }
    const primary = held.values().next().value;
    if (command === "get" || command === "is") {
      const what = text$3(args.what);
      if (!primary) throw new ApplicationError("INVALID_INPUT", "读取元素属性需要element引用");
      if (what === "count") result = 1;
      else if (what === "text" || what === "html" || what === "value" || what === "box" || what === "visible" || what === "enabled" || what === "checked") result = await primary.read(what);
      else throw new ApplicationError("INVALID_INPUT", "不支持的元素属性");
    } else if ((command === "hover" || command === "dblclick") && primary.hostClick) {
      await primary.pointer(command, { signal, dispatched: send, notStarted });
      result = { completed: true };
    } else if (command === "scrollintoview") {
      await primary.scroll({ signal, dispatched: send, notStarted });
      result = { scrolled: true };
    } else if (command === "highlight") {
      await primary.highlight({ signal, dispatched: send, notStarted });
      result = { highlighted: true };
    } else if (command === "focus") {
      await primary.focus({ signal, dispatched: send, notStarted });
      result = { focused: true };
    } else if (command === "clear") result = await primary.fill("", { signal, dispatched: send, notStarted });
    else if (command === "select-all") {
      await primary.selectAll({ signal, dispatched: send, notStarted });
      result = { selected: true };
    } else if (command === "select") {
      await primary.select(text$3(args.value), { signal, dispatched: send, notStarted });
      result = { selected: true };
    } else if (command === "upload") {
      await primary.upload(native.slice(2).map((path2) => node_path.resolve(context.cwd, path2)), { signal, dispatched: send, notStarted });
      result = { uploaded: true };
    } else if (command === "check" || command === "uncheck") {
      const checked = command === "check";
      if (await primary.read("checked") !== checked) await primary.click({ signal, dispatched: send, notStarted });
      if (await primary.read("checked") !== checked) throw new BrowserError("BROWSER_ERROR", "复选状态未达到请求值，请先核对页面");
      result = { checked };
    } else {
      const argv = native.map((arg) => held.get(arg)?.selector ?? arg);
      result = await page.helper.command(argv, { signal, dispatched: send, ...command === "wait fn" ? { timeout: Number(args.timeout ?? 25e3) + 5e3 } : {} });
    }
  } catch (cause) {
    error2 = cause;
  }
  const guards = [];
  const references = [...held.values()];
  for (const [index2, reference] of references.entries()) {
    const sameWorldLater = references.slice(index2 + 1).some((other) => other.node.frameId === reference.node.frameId && other.node.sessionId === reference.node.sessionId);
    try {
      guards.push(await reference.finish(sameWorldLater));
    } catch (cause) {
      error2 ??= cause;
    }
  }
  if (guards.some((guard) => guard.blocked.length || !guard.connected)) {
    throw staleReference();
  }
  if (error2) throw error2;
  if (command === "wait fn") return { handled: true, result: { waited: true } };
  return { handled: true, result: { result } };
}
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var utils = {};
var constants;
var hasRequiredConstants;
function requireConstants() {
  if (hasRequiredConstants) return constants;
  hasRequiredConstants = 1;
  const WIN_SLASH = "\\\\/";
  const WIN_NO_SLASH = `[^${WIN_SLASH}]`;
  const DEFAULT_MAX_EXTGLOB_RECURSION = 0;
  const DOT_LITERAL = "\\.";
  const PLUS_LITERAL = "\\+";
  const QMARK_LITERAL = "\\?";
  const SLASH_LITERAL = "\\/";
  const ONE_CHAR = "(?=.)";
  const QMARK = "[^/]";
  const END_ANCHOR = `(?:${SLASH_LITERAL}|$)`;
  const START_ANCHOR = `(?:^|${SLASH_LITERAL})`;
  const DOTS_SLASH = `${DOT_LITERAL}{1,2}${END_ANCHOR}`;
  const NO_DOT = `(?!${DOT_LITERAL})`;
  const NO_DOTS = `(?!${START_ANCHOR}${DOTS_SLASH})`;
  const NO_DOT_SLASH = `(?!${DOT_LITERAL}{0,1}${END_ANCHOR})`;
  const NO_DOTS_SLASH = `(?!${DOTS_SLASH})`;
  const QMARK_NO_DOT = `[^.${SLASH_LITERAL}]`;
  const STAR = `${QMARK}*?`;
  const SEP = "/";
  const POSIX_CHARS = {
    DOT_LITERAL,
    PLUS_LITERAL,
    QMARK_LITERAL,
    SLASH_LITERAL,
    ONE_CHAR,
    QMARK,
    END_ANCHOR,
    DOTS_SLASH,
    NO_DOT,
    NO_DOTS,
    NO_DOT_SLASH,
    NO_DOTS_SLASH,
    QMARK_NO_DOT,
    STAR,
    START_ANCHOR,
    SEP
  };
  const WINDOWS_CHARS = {
    ...POSIX_CHARS,
    SLASH_LITERAL: `[${WIN_SLASH}]`,
    QMARK: WIN_NO_SLASH,
    STAR: `${WIN_NO_SLASH}*?`,
    DOTS_SLASH: `${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$)`,
    NO_DOT: `(?!${DOT_LITERAL})`,
    NO_DOTS: `(?!(?:^|[${WIN_SLASH}])${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
    NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}(?:[${WIN_SLASH}]|$))`,
    NO_DOTS_SLASH: `(?!${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
    QMARK_NO_DOT: `[^.${WIN_SLASH}]`,
    START_ANCHOR: `(?:^|[${WIN_SLASH}])`,
    END_ANCHOR: `(?:[${WIN_SLASH}]|$)`,
    SEP: "\\"
  };
  const POSIX_REGEX_SOURCE = {
    __proto__: null,
    alnum: "a-zA-Z0-9",
    alpha: "a-zA-Z",
    ascii: "\\x00-\\x7F",
    blank: " \\t",
    cntrl: "\\x00-\\x1F\\x7F",
    digit: "0-9",
    graph: "\\x21-\\x7E",
    lower: "a-z",
    print: "\\x20-\\x7E ",
    punct: "\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~",
    space: " \\t\\r\\n\\v\\f",
    upper: "A-Z",
    word: "A-Za-z0-9_",
    xdigit: "A-Fa-f0-9"
  };
  constants = {
    DEFAULT_MAX_EXTGLOB_RECURSION,
    MAX_LENGTH: 1024 * 64,
    POSIX_REGEX_SOURCE,
    // regular expressions
    REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
    REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
    REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
    REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
    REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
    REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,
    // Replace globs with equivalent patterns to reduce parsing time.
    REPLACEMENTS: {
      __proto__: null,
      "***": "*",
      "**/**": "**",
      "**/**/**": "**"
    },
    // Digits
    CHAR_0: 48,
    /* 0 */
    CHAR_9: 57,
    /* 9 */
    // Alphabet chars.
    CHAR_UPPERCASE_A: 65,
    /* A */
    CHAR_LOWERCASE_A: 97,
    /* a */
    CHAR_UPPERCASE_Z: 90,
    /* Z */
    CHAR_LOWERCASE_Z: 122,
    /* z */
    CHAR_LEFT_PARENTHESES: 40,
    /* ( */
    CHAR_RIGHT_PARENTHESES: 41,
    /* ) */
    CHAR_ASTERISK: 42,
    /* * */
    // Non-alphabetic chars.
    CHAR_AMPERSAND: 38,
    /* & */
    CHAR_AT: 64,
    /* @ */
    CHAR_BACKWARD_SLASH: 92,
    /* \ */
    CHAR_CARRIAGE_RETURN: 13,
    /* \r */
    CHAR_CIRCUMFLEX_ACCENT: 94,
    /* ^ */
    CHAR_COLON: 58,
    /* : */
    CHAR_COMMA: 44,
    /* , */
    CHAR_DOT: 46,
    /* . */
    CHAR_DOUBLE_QUOTE: 34,
    /* " */
    CHAR_EQUAL: 61,
    /* = */
    CHAR_EXCLAMATION_MARK: 33,
    /* ! */
    CHAR_FORM_FEED: 12,
    /* \f */
    CHAR_FORWARD_SLASH: 47,
    /* / */
    CHAR_GRAVE_ACCENT: 96,
    /* ` */
    CHAR_HASH: 35,
    /* # */
    CHAR_HYPHEN_MINUS: 45,
    /* - */
    CHAR_LEFT_ANGLE_BRACKET: 60,
    /* < */
    CHAR_LEFT_CURLY_BRACE: 123,
    /* { */
    CHAR_LEFT_SQUARE_BRACKET: 91,
    /* [ */
    CHAR_LINE_FEED: 10,
    /* \n */
    CHAR_NO_BREAK_SPACE: 160,
    /* \u00A0 */
    CHAR_PERCENT: 37,
    /* % */
    CHAR_PLUS: 43,
    /* + */
    CHAR_QUESTION_MARK: 63,
    /* ? */
    CHAR_RIGHT_ANGLE_BRACKET: 62,
    /* > */
    CHAR_RIGHT_CURLY_BRACE: 125,
    /* } */
    CHAR_RIGHT_SQUARE_BRACKET: 93,
    /* ] */
    CHAR_SEMICOLON: 59,
    /* ; */
    CHAR_SINGLE_QUOTE: 39,
    /* ' */
    CHAR_SPACE: 32,
    /*   */
    CHAR_TAB: 9,
    /* \t */
    CHAR_UNDERSCORE: 95,
    /* _ */
    CHAR_VERTICAL_LINE: 124,
    /* | */
    CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
    /* \uFEFF */
    /**
     * Create EXTGLOB_CHARS
     */
    extglobChars(chars) {
      return {
        "!": { type: "negate", open: "(?:(?!(?:", close: `))${chars.STAR})` },
        "?": { type: "qmark", open: "(?:", close: ")?" },
        "+": { type: "plus", open: "(?:", close: ")+" },
        "*": { type: "star", open: "(?:", close: ")*" },
        "@": { type: "at", open: "(?:", close: ")" }
      };
    },
    /**
     * Create GLOB_CHARS
     */
    globChars(win32) {
      return win32 === true ? WINDOWS_CHARS : POSIX_CHARS;
    }
  };
  return constants;
}
var hasRequiredUtils;
function requireUtils() {
  if (hasRequiredUtils) return utils;
  hasRequiredUtils = 1;
  (function(exports2) {
    const {
      REGEX_BACKSLASH,
      REGEX_REMOVE_BACKSLASH,
      REGEX_SPECIAL_CHARS,
      REGEX_SPECIAL_CHARS_GLOBAL
    } = /* @__PURE__ */ requireConstants();
    exports2.isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
    exports2.hasRegexChars = (str) => REGEX_SPECIAL_CHARS.test(str);
    exports2.isRegexChar = (str) => str.length === 1 && exports2.hasRegexChars(str);
    exports2.escapeRegex = (str) => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, "\\$1");
    exports2.toPosixSlashes = (str) => str.replace(REGEX_BACKSLASH, "/");
    exports2.isWindows = () => {
      if (typeof navigator !== "undefined" && navigator.platform) {
        const platform = navigator.platform.toLowerCase();
        return platform === "win32" || platform === "windows";
      }
      if (typeof process !== "undefined" && process.platform) {
        return process.platform === "win32";
      }
      return false;
    };
    exports2.removeBackslashes = (str) => {
      return str.replace(REGEX_REMOVE_BACKSLASH, (match) => {
        return match === "\\" ? "" : match;
      });
    };
    exports2.escapeLast = (input, char, lastIdx) => {
      const idx = input.lastIndexOf(char, lastIdx);
      if (idx === -1) return input;
      if (input[idx - 1] === "\\") return exports2.escapeLast(input, char, idx - 1);
      return `${input.slice(0, idx)}\\${input.slice(idx)}`;
    };
    exports2.removePrefix = (input, state2 = {}) => {
      let output = input;
      if (output.startsWith("./")) {
        output = output.slice(2);
        state2.prefix = "./";
      }
      return output;
    };
    exports2.wrapOutput = (input, state2 = {}, options = {}) => {
      const prepend = options.contains ? "" : "^";
      const append = options.contains ? "" : "$";
      let output = `${prepend}(?:${input})${append}`;
      if (state2.negated === true) {
        output = `(?:^(?!${output}).*$)`;
      }
      return output;
    };
    exports2.basename = (path2, { windows } = {}) => {
      const segs = path2.split(windows ? /[\\/]/ : "/");
      const last = segs[segs.length - 1];
      if (last === "") {
        return segs[segs.length - 2];
      }
      return last;
    };
  })(utils);
  return utils;
}
var scan_1;
var hasRequiredScan;
function requireScan() {
  if (hasRequiredScan) return scan_1;
  hasRequiredScan = 1;
  const utils2 = /* @__PURE__ */ requireUtils();
  const {
    CHAR_ASTERISK,
    /* * */
    CHAR_AT,
    /* @ */
    CHAR_BACKWARD_SLASH,
    /* \ */
    CHAR_COMMA,
    /* , */
    CHAR_DOT,
    /* . */
    CHAR_EXCLAMATION_MARK,
    /* ! */
    CHAR_FORWARD_SLASH,
    /* / */
    CHAR_LEFT_CURLY_BRACE,
    /* { */
    CHAR_LEFT_PARENTHESES,
    /* ( */
    CHAR_LEFT_SQUARE_BRACKET,
    /* [ */
    CHAR_PLUS,
    /* + */
    CHAR_QUESTION_MARK,
    /* ? */
    CHAR_RIGHT_CURLY_BRACE,
    /* } */
    CHAR_RIGHT_PARENTHESES,
    /* ) */
    CHAR_RIGHT_SQUARE_BRACKET
    /* ] */
  } = /* @__PURE__ */ requireConstants();
  const isPathSeparator = (code) => {
    return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
  };
  const depth = (token) => {
    if (token.isPrefix !== true) {
      token.depth = token.isGlobstar ? Infinity : 1;
    }
  };
  const scan = (input, options) => {
    const opts = options || {};
    const length = input.length - 1;
    const scanToEnd = opts.parts === true || opts.scanToEnd === true;
    const slashes = [];
    const tokens = [];
    const parts = [];
    let str = input;
    let index2 = -1;
    let start = 0;
    let lastIndex = 0;
    let isBrace = false;
    let isBracket = false;
    let isGlob = false;
    let isExtglob = false;
    let isGlobstar = false;
    let braceEscaped = false;
    let backslashes = false;
    let negated = false;
    let negatedExtglob = false;
    let finished = false;
    let braces = 0;
    let prev;
    let code;
    let token = { value: "", depth: 0, isGlob: false };
    const eos = () => index2 >= length;
    const peek = () => str.charCodeAt(index2 + 1);
    const advance = () => {
      prev = code;
      return str.charCodeAt(++index2);
    };
    while (index2 < length) {
      code = advance();
      let next;
      if (code === CHAR_BACKWARD_SLASH) {
        backslashes = token.backslashes = true;
        code = advance();
        if (code === CHAR_LEFT_CURLY_BRACE) {
          braceEscaped = true;
        }
        continue;
      }
      if (braceEscaped === true || code === CHAR_LEFT_CURLY_BRACE) {
        braces++;
        while (eos() !== true && (code = advance())) {
          if (code === CHAR_BACKWARD_SLASH) {
            backslashes = token.backslashes = true;
            advance();
            continue;
          }
          if (code === CHAR_LEFT_CURLY_BRACE) {
            braces++;
            continue;
          }
          if (braceEscaped !== true && code === CHAR_DOT && (code = advance()) === CHAR_DOT) {
            isBrace = token.isBrace = true;
            isGlob = token.isGlob = true;
            finished = true;
            if (scanToEnd === true) {
              continue;
            }
            break;
          }
          if (braceEscaped !== true && code === CHAR_COMMA) {
            isBrace = token.isBrace = true;
            isGlob = token.isGlob = true;
            finished = true;
            if (scanToEnd === true) {
              continue;
            }
            break;
          }
          if (code === CHAR_RIGHT_CURLY_BRACE) {
            braces--;
            if (braces === 0) {
              braceEscaped = false;
              isBrace = token.isBrace = true;
              finished = true;
              break;
            }
          }
        }
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (code === CHAR_FORWARD_SLASH) {
        slashes.push(index2);
        tokens.push(token);
        token = { value: "", depth: 0, isGlob: false };
        if (finished === true) continue;
        if (prev === CHAR_DOT && index2 === start + 1) {
          start += 2;
          continue;
        }
        lastIndex = index2 + 1;
        continue;
      }
      if (opts.noext !== true) {
        const isExtglobChar = code === CHAR_PLUS || code === CHAR_AT || code === CHAR_ASTERISK || code === CHAR_QUESTION_MARK || code === CHAR_EXCLAMATION_MARK;
        if (isExtglobChar === true && peek() === CHAR_LEFT_PARENTHESES) {
          isGlob = token.isGlob = true;
          isExtglob = token.isExtglob = true;
          finished = true;
          if (code === CHAR_EXCLAMATION_MARK && index2 === start) {
            negatedExtglob = true;
          }
          if (scanToEnd === true) {
            while (eos() !== true && (code = advance())) {
              if (code === CHAR_BACKWARD_SLASH) {
                backslashes = token.backslashes = true;
                code = advance();
                continue;
              }
              if (code === CHAR_RIGHT_PARENTHESES) {
                isGlob = token.isGlob = true;
                finished = true;
                break;
              }
            }
            continue;
          }
          break;
        }
      }
      if (code === CHAR_ASTERISK) {
        if (prev === CHAR_ASTERISK) isGlobstar = token.isGlobstar = true;
        isGlob = token.isGlob = true;
        finished = true;
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (code === CHAR_QUESTION_MARK) {
        isGlob = token.isGlob = true;
        finished = true;
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (code === CHAR_LEFT_SQUARE_BRACKET) {
        while (eos() !== true && (next = advance())) {
          if (next === CHAR_BACKWARD_SLASH) {
            backslashes = token.backslashes = true;
            advance();
            continue;
          }
          if (next === CHAR_RIGHT_SQUARE_BRACKET) {
            isBracket = token.isBracket = true;
            isGlob = token.isGlob = true;
            finished = true;
            break;
          }
        }
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (opts.nonegate !== true && code === CHAR_EXCLAMATION_MARK && index2 === start) {
        negated = token.negated = true;
        start++;
        continue;
      }
      if (opts.noparen !== true && code === CHAR_LEFT_PARENTHESES) {
        isGlob = token.isGlob = true;
        if (scanToEnd === true) {
          while (eos() !== true && (code = advance())) {
            if (code === CHAR_LEFT_PARENTHESES) {
              backslashes = token.backslashes = true;
              code = advance();
              continue;
            }
            if (code === CHAR_RIGHT_PARENTHESES) {
              finished = true;
              break;
            }
          }
          continue;
        }
        break;
      }
      if (isGlob === true) {
        finished = true;
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
    }
    if (opts.noext === true) {
      isExtglob = false;
      isGlob = false;
    }
    let base = str;
    let prefix = "";
    let glob = "";
    if (start > 0) {
      prefix = str.slice(0, start);
      str = str.slice(start);
      lastIndex -= start;
    }
    if (base && isGlob === true && lastIndex > 0) {
      base = str.slice(0, lastIndex);
      glob = str.slice(lastIndex);
    } else if (isGlob === true) {
      base = "";
      glob = str;
    } else {
      base = str;
    }
    if (base && base !== "" && base !== "/" && base !== str) {
      if (isPathSeparator(base.charCodeAt(base.length - 1))) {
        base = base.slice(0, -1);
      }
    }
    if (opts.unescape === true) {
      if (glob) glob = utils2.removeBackslashes(glob);
      if (base && backslashes === true) {
        base = utils2.removeBackslashes(base);
      }
    }
    const state2 = {
      prefix,
      input,
      start,
      base,
      glob,
      isBrace,
      isBracket,
      isGlob,
      isExtglob,
      isGlobstar,
      negated,
      negatedExtglob
    };
    if (opts.tokens === true) {
      state2.maxDepth = 0;
      if (!isPathSeparator(code)) {
        tokens.push(token);
      }
      state2.tokens = tokens;
    }
    if (opts.parts === true || opts.tokens === true) {
      let prevIndex;
      for (let idx = 0; idx < slashes.length; idx++) {
        const n = prevIndex ? prevIndex + 1 : start;
        const i = slashes[idx];
        const value = input.slice(n, i);
        if (opts.tokens) {
          if (idx === 0 && start !== 0) {
            tokens[idx].isPrefix = true;
            tokens[idx].value = prefix;
          } else {
            tokens[idx].value = value;
          }
          depth(tokens[idx]);
          state2.maxDepth += tokens[idx].depth;
        }
        if (idx !== 0 || value !== "") {
          parts.push(value);
        }
        prevIndex = i;
      }
      if (prevIndex && prevIndex + 1 < input.length) {
        const value = input.slice(prevIndex + 1);
        parts.push(value);
        if (opts.tokens) {
          tokens[tokens.length - 1].value = value;
          depth(tokens[tokens.length - 1]);
          state2.maxDepth += tokens[tokens.length - 1].depth;
        }
      }
      state2.slashes = slashes;
      state2.parts = parts;
    }
    return state2;
  };
  scan_1 = scan;
  return scan_1;
}
var parse_1;
var hasRequiredParse;
function requireParse() {
  if (hasRequiredParse) return parse_1;
  hasRequiredParse = 1;
  const constants2 = /* @__PURE__ */ requireConstants();
  const utils2 = /* @__PURE__ */ requireUtils();
  const {
    MAX_LENGTH,
    POSIX_REGEX_SOURCE,
    REGEX_NON_SPECIAL_CHARS,
    REGEX_SPECIAL_CHARS_BACKREF,
    REPLACEMENTS
  } = constants2;
  const expandRange = (args, options) => {
    if (typeof options.expandRange === "function") {
      return options.expandRange(...args, options);
    }
    args.sort();
    const value = `[${args.join("-")}]`;
    try {
      new RegExp(value);
    } catch (ex) {
      return args.map((v) => utils2.escapeRegex(v)).join("..");
    }
    return value;
  };
  const syntaxError = (type, char) => {
    return `Missing ${type}: "${char}" - use "\\\\${char}" to match literal characters`;
  };
  const splitTopLevel = (input) => {
    const parts = [];
    let bracket = 0;
    let paren = 0;
    let quote = 0;
    let value = "";
    let escaped = false;
    for (const ch of input) {
      if (escaped === true) {
        value += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        value += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        quote = quote === 1 ? 0 : 1;
        value += ch;
        continue;
      }
      if (quote === 0) {
        if (ch === "[") {
          bracket++;
        } else if (ch === "]" && bracket > 0) {
          bracket--;
        } else if (bracket === 0) {
          if (ch === "(") {
            paren++;
          } else if (ch === ")" && paren > 0) {
            paren--;
          } else if (ch === "|" && paren === 0) {
            parts.push(value);
            value = "";
            continue;
          }
        }
      }
      value += ch;
    }
    parts.push(value);
    return parts;
  };
  const isPlainBranch = (branch) => {
    let escaped = false;
    for (const ch of branch) {
      if (escaped === true) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (/[?*+@!()[\]{}]/.test(ch)) {
        return false;
      }
    }
    return true;
  };
  const normalizeSimpleBranch = (branch) => {
    let value = branch.trim();
    let changed = true;
    while (changed === true) {
      changed = false;
      if (/^@\([^\\()[\]{}|]+\)$/.test(value)) {
        value = value.slice(2, -1);
        changed = true;
      }
    }
    if (!isPlainBranch(value)) {
      return;
    }
    return value.replace(/\\(.)/g, "$1");
  };
  const hasRepeatedCharPrefixOverlap = (branches) => {
    const values = branches.map(normalizeSimpleBranch).filter(Boolean);
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const a = values[i];
        const b = values[j];
        const char = a[0];
        if (!char || a !== char.repeat(a.length) || b !== char.repeat(b.length)) {
          continue;
        }
        if (a === b || a.startsWith(b) || b.startsWith(a)) {
          return true;
        }
      }
    }
    return false;
  };
  const parseRepeatedExtglob = (pattern, requireEnd = true) => {
    if (pattern[0] !== "+" && pattern[0] !== "*" || pattern[1] !== "(") {
      return;
    }
    let bracket = 0;
    let paren = 0;
    let quote = 0;
    let escaped = false;
    for (let i = 1; i < pattern.length; i++) {
      const ch = pattern[i];
      if (escaped === true) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        quote = quote === 1 ? 0 : 1;
        continue;
      }
      if (quote === 1) {
        continue;
      }
      if (ch === "[") {
        bracket++;
        continue;
      }
      if (ch === "]" && bracket > 0) {
        bracket--;
        continue;
      }
      if (bracket > 0) {
        continue;
      }
      if (ch === "(") {
        paren++;
        continue;
      }
      if (ch === ")") {
        paren--;
        if (paren === 0) {
          if (requireEnd === true && i !== pattern.length - 1) {
            return;
          }
          return {
            type: pattern[0],
            body: pattern.slice(2, i),
            end: i
          };
        }
      }
    }
  };
  const getStarExtglobSequenceOutput = (pattern) => {
    let index2 = 0;
    const chars = [];
    while (index2 < pattern.length) {
      const match = parseRepeatedExtglob(pattern.slice(index2), false);
      if (!match || match.type !== "*") {
        return;
      }
      const branches = splitTopLevel(match.body).map((branch2) => branch2.trim());
      if (branches.length !== 1) {
        return;
      }
      const branch = normalizeSimpleBranch(branches[0]);
      if (!branch || branch.length !== 1) {
        return;
      }
      chars.push(branch);
      index2 += match.end + 1;
    }
    if (chars.length < 1) {
      return;
    }
    const source = chars.length === 1 ? utils2.escapeRegex(chars[0]) : `[${chars.map((ch) => utils2.escapeRegex(ch)).join("")}]`;
    return `${source}*`;
  };
  const repeatedExtglobRecursion = (pattern) => {
    let depth = 0;
    let value = pattern.trim();
    let match = parseRepeatedExtglob(value);
    while (match) {
      depth++;
      value = match.body.trim();
      match = parseRepeatedExtglob(value);
    }
    return depth;
  };
  const analyzeRepeatedExtglob = (body, options) => {
    if (options.maxExtglobRecursion === false) {
      return { risky: false };
    }
    const max = typeof options.maxExtglobRecursion === "number" ? options.maxExtglobRecursion : constants2.DEFAULT_MAX_EXTGLOB_RECURSION;
    const branches = splitTopLevel(body).map((branch) => branch.trim());
    if (branches.length > 1) {
      if (branches.some((branch) => branch === "") || branches.some((branch) => /^[*?]+$/.test(branch)) || hasRepeatedCharPrefixOverlap(branches)) {
        return { risky: true };
      }
    }
    for (const branch of branches) {
      const safeOutput = getStarExtglobSequenceOutput(branch);
      if (safeOutput) {
        return { risky: true, safeOutput };
      }
      if (repeatedExtglobRecursion(branch) > max) {
        return { risky: true };
      }
    }
    return { risky: false };
  };
  const parse2 = (input, options) => {
    if (typeof input !== "string") {
      throw new TypeError("Expected a string");
    }
    input = REPLACEMENTS[input] || input;
    const opts = { ...options };
    const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
    let len = input.length;
    if (len > max) {
      throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
    }
    const bos = { type: "bos", value: "", output: opts.prepend || "" };
    const tokens = [bos];
    const capture = opts.capture ? "" : "?:";
    const PLATFORM_CHARS = constants2.globChars(opts.windows);
    const EXTGLOB_CHARS = constants2.extglobChars(PLATFORM_CHARS);
    const {
      DOT_LITERAL,
      PLUS_LITERAL,
      SLASH_LITERAL,
      ONE_CHAR,
      DOTS_SLASH,
      NO_DOT,
      NO_DOT_SLASH,
      NO_DOTS_SLASH,
      QMARK,
      QMARK_NO_DOT,
      STAR,
      START_ANCHOR
    } = PLATFORM_CHARS;
    const globstar = (opts2) => {
      return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
    };
    const nodot = opts.dot ? "" : NO_DOT;
    const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
    let star = opts.bash === true ? globstar(opts) : STAR;
    if (opts.capture) {
      star = `(${star})`;
    }
    if (typeof opts.noext === "boolean") {
      opts.noextglob = opts.noext;
    }
    const state2 = {
      input,
      index: -1,
      start: 0,
      dot: opts.dot === true,
      consumed: "",
      output: "",
      prefix: "",
      backtrack: false,
      negated: false,
      brackets: 0,
      braces: 0,
      parens: 0,
      quotes: 0,
      globstar: false,
      tokens
    };
    input = utils2.removePrefix(input, state2);
    len = input.length;
    const extglobs = [];
    const braces = [];
    const stack = [];
    let prev = bos;
    let value;
    const eos = () => state2.index === len - 1;
    const peek = state2.peek = (n = 1) => input[state2.index + n];
    const advance = state2.advance = () => input[++state2.index] || "";
    const remaining = () => input.slice(state2.index + 1);
    const consume = (value2 = "", num = 0) => {
      state2.consumed += value2;
      state2.index += num;
    };
    const append = (token) => {
      state2.output += token.output != null ? token.output : token.value;
      consume(token.value);
    };
    const negate = () => {
      let count = 1;
      while (peek() === "!" && (peek(2) !== "(" || peek(3) === "?")) {
        advance();
        state2.start++;
        count++;
      }
      if (count % 2 === 0) {
        return false;
      }
      state2.negated = true;
      state2.start++;
      return true;
    };
    const increment = (type) => {
      state2[type]++;
      stack.push(type);
    };
    const decrement = (type) => {
      state2[type]--;
      stack.pop();
    };
    const push = (tok) => {
      if (prev.type === "globstar") {
        const isBrace = state2.braces > 0 && (tok.type === "comma" || tok.type === "brace");
        const isExtglob = tok.extglob === true || extglobs.length && (tok.type === "pipe" || tok.type === "paren");
        if (tok.type !== "slash" && tok.type !== "paren" && !isBrace && !isExtglob) {
          state2.output = state2.output.slice(0, -prev.output.length);
          prev.type = "star";
          prev.value = "*";
          prev.output = star;
          state2.output += prev.output;
        }
      }
      if (extglobs.length && tok.type !== "paren") {
        extglobs[extglobs.length - 1].inner += tok.value;
      }
      if (tok.value || tok.output) append(tok);
      if (prev && prev.type === "text" && tok.type === "text") {
        prev.output = (prev.output || prev.value) + tok.value;
        prev.value += tok.value;
        return;
      }
      tok.prev = prev;
      tokens.push(tok);
      prev = tok;
    };
    const extglobOpen = (type, value2) => {
      const token = { ...EXTGLOB_CHARS[value2], conditions: 1, inner: "" };
      token.prev = prev;
      token.parens = state2.parens;
      token.output = state2.output;
      token.startIndex = state2.index;
      token.tokensIndex = tokens.length;
      const output = (opts.capture ? "(" : "") + token.open;
      increment("parens");
      push({ type, value: value2, output: state2.output ? "" : ONE_CHAR });
      push({ type: "paren", extglob: true, value: advance(), output });
      extglobs.push(token);
    };
    const extglobClose = (token) => {
      const literal2 = input.slice(token.startIndex, state2.index + 1);
      const body = input.slice(token.startIndex + 2, state2.index);
      const analysis = analyzeRepeatedExtglob(body, opts);
      if ((token.type === "plus" || token.type === "star") && analysis.risky) {
        const safeOutput = analysis.safeOutput ? (token.output ? "" : ONE_CHAR) + (opts.capture ? `(${analysis.safeOutput})` : analysis.safeOutput) : void 0;
        const open2 = tokens[token.tokensIndex];
        open2.type = "text";
        open2.value = literal2;
        open2.output = safeOutput || utils2.escapeRegex(literal2);
        for (let i = token.tokensIndex + 1; i < tokens.length; i++) {
          tokens[i].value = "";
          tokens[i].output = "";
          delete tokens[i].suffix;
        }
        state2.output = token.output + open2.output;
        state2.backtrack = true;
        push({ type: "paren", extglob: true, value, output: "" });
        decrement("parens");
        return;
      }
      let output = token.close + (opts.capture ? ")" : "");
      let rest;
      if (token.type === "negate") {
        let extglobStar = star;
        if (token.inner && token.inner.length > 1 && token.inner.includes("/")) {
          extglobStar = globstar(opts);
        }
        if (extglobStar !== star || eos() || /^\)+$/.test(remaining())) {
          output = token.close = `)$))${extglobStar}`;
        }
        if (token.inner.includes("*") && (rest = remaining()) && /^\.[^\\/.]+$/.test(rest)) {
          const expression = parse2(rest, { ...options, fastpaths: false }).output;
          output = token.close = `)${expression})${extglobStar})`;
        }
        if (token.prev.type === "bos") {
          state2.negatedExtglob = true;
        }
      }
      push({ type: "paren", extglob: true, value, output });
      decrement("parens");
    };
    if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
      let backslashes = false;
      let output = input.replace(REGEX_SPECIAL_CHARS_BACKREF, (m, esc2, chars, first, rest, index2) => {
        if (first === "\\") {
          backslashes = true;
          return m;
        }
        if (first === "?") {
          if (esc2) {
            return esc2 + first + (rest ? QMARK.repeat(rest.length) : "");
          }
          if (index2 === 0) {
            return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : "");
          }
          return QMARK.repeat(chars.length);
        }
        if (first === ".") {
          return DOT_LITERAL.repeat(chars.length);
        }
        if (first === "*") {
          if (esc2) {
            return esc2 + first + (rest ? star : "");
          }
          return star;
        }
        return esc2 ? m : `\\${m}`;
      });
      if (backslashes === true) {
        if (opts.unescape === true) {
          output = output.replace(/\\/g, "");
        } else {
          output = output.replace(/\\+/g, (m) => {
            return m.length % 2 === 0 ? "\\\\" : m ? "\\" : "";
          });
        }
      }
      if (output === input && opts.contains === true) {
        state2.output = input;
        return state2;
      }
      state2.output = utils2.wrapOutput(output, state2, options);
      return state2;
    }
    while (!eos()) {
      value = advance();
      if (value === "\0") {
        continue;
      }
      if (value === "\\") {
        const next = peek();
        if (next === "/" && opts.bash !== true) {
          continue;
        }
        if (next === "." || next === ";") {
          continue;
        }
        if (!next) {
          value += "\\";
          push({ type: "text", value });
          continue;
        }
        const match = /^\\+/.exec(remaining());
        let slashes = 0;
        if (match && match[0].length > 2) {
          slashes = match[0].length;
          state2.index += slashes;
          if (slashes % 2 !== 0) {
            value += "\\";
          }
        }
        if (opts.unescape === true) {
          value = advance();
        } else {
          value += advance();
        }
        if (state2.brackets === 0) {
          push({ type: "text", value });
          continue;
        }
      }
      if (state2.brackets > 0 && (value !== "]" || prev.value === "[" || prev.value === "[^")) {
        if (opts.posix !== false && value === ":") {
          const inner = prev.value.slice(1);
          if (inner.includes("[")) {
            prev.posix = true;
            if (inner.includes(":")) {
              const idx = prev.value.lastIndexOf("[");
              const pre = prev.value.slice(0, idx);
              const rest2 = prev.value.slice(idx + 2);
              const posix = POSIX_REGEX_SOURCE[rest2];
              if (posix) {
                prev.value = pre + posix;
                state2.backtrack = true;
                advance();
                if (!bos.output && tokens.indexOf(prev) === 1) {
                  bos.output = ONE_CHAR;
                }
                continue;
              }
            }
          }
        }
        if (value === "[" && peek() !== ":" || value === "-" && peek() === "]") {
          value = `\\${value}`;
        }
        if (value === "]" && (prev.value === "[" || prev.value === "[^")) {
          value = `\\${value}`;
        }
        if (opts.posix === true && value === "!" && prev.value === "[") {
          value = "^";
        }
        prev.value += value;
        append({ value });
        continue;
      }
      if (state2.quotes === 1 && value !== '"') {
        value = utils2.escapeRegex(value);
        prev.value += value;
        append({ value });
        continue;
      }
      if (value === '"') {
        state2.quotes = state2.quotes === 1 ? 0 : 1;
        if (opts.keepQuotes === true) {
          push({ type: "text", value });
        }
        continue;
      }
      if (value === "(") {
        increment("parens");
        push({ type: "paren", value });
        continue;
      }
      if (value === ")") {
        if (state2.parens === 0 && opts.strictBrackets === true) {
          throw new SyntaxError(syntaxError("opening", "("));
        }
        const extglob = extglobs[extglobs.length - 1];
        if (extglob && state2.parens === extglob.parens + 1) {
          extglobClose(extglobs.pop());
          continue;
        }
        push({ type: "paren", value, output: state2.parens ? ")" : "\\)" });
        decrement("parens");
        continue;
      }
      if (value === "[") {
        if (opts.nobracket === true || !remaining().includes("]")) {
          if (opts.nobracket !== true && opts.strictBrackets === true) {
            throw new SyntaxError(syntaxError("closing", "]"));
          }
          value = `\\${value}`;
        } else {
          increment("brackets");
        }
        push({ type: "bracket", value });
        continue;
      }
      if (value === "]") {
        if (opts.nobracket === true || prev && prev.type === "bracket" && prev.value.length === 1) {
          push({ type: "text", value, output: `\\${value}` });
          continue;
        }
        if (state2.brackets === 0) {
          if (opts.strictBrackets === true) {
            throw new SyntaxError(syntaxError("opening", "["));
          }
          push({ type: "text", value, output: `\\${value}` });
          continue;
        }
        decrement("brackets");
        const prevValue = prev.value.slice(1);
        if (prev.posix !== true && prevValue[0] === "^" && !prevValue.includes("/")) {
          value = `/${value}`;
        }
        prev.value += value;
        append({ value });
        if (opts.literalBrackets === false || utils2.hasRegexChars(prevValue)) {
          continue;
        }
        const escaped = utils2.escapeRegex(prev.value);
        state2.output = state2.output.slice(0, -prev.value.length);
        if (opts.literalBrackets === true) {
          state2.output += escaped;
          prev.value = escaped;
          continue;
        }
        prev.value = `(${capture}${escaped}|${prev.value})`;
        state2.output += prev.value;
        continue;
      }
      if (value === "{" && opts.nobrace !== true) {
        increment("braces");
        const open2 = {
          type: "brace",
          value,
          output: "(",
          outputIndex: state2.output.length,
          tokensIndex: state2.tokens.length
        };
        braces.push(open2);
        push(open2);
        continue;
      }
      if (value === "}") {
        const brace = braces[braces.length - 1];
        if (opts.nobrace === true || !brace) {
          push({ type: "text", value, output: value });
          continue;
        }
        let output = ")";
        if (brace.dots === true) {
          const arr = tokens.slice();
          const range = [];
          for (let i = arr.length - 1; i >= 0; i--) {
            tokens.pop();
            if (arr[i].type === "brace") {
              break;
            }
            if (arr[i].type !== "dots") {
              range.unshift(arr[i].value);
            }
          }
          output = expandRange(range, opts);
          state2.backtrack = true;
        }
        if (brace.comma !== true && brace.dots !== true) {
          const out = state2.output.slice(0, brace.outputIndex);
          const toks = state2.tokens.slice(brace.tokensIndex);
          brace.value = brace.output = "\\{";
          value = output = "\\}";
          state2.output = out;
          for (const t of toks) {
            state2.output += t.output || t.value;
          }
        }
        push({ type: "brace", value, output });
        decrement("braces");
        braces.pop();
        continue;
      }
      if (value === "|") {
        if (extglobs.length > 0) {
          extglobs[extglobs.length - 1].conditions++;
        }
        push({ type: "text", value });
        continue;
      }
      if (value === ",") {
        let output = value;
        const brace = braces[braces.length - 1];
        if (brace && stack[stack.length - 1] === "braces") {
          brace.comma = true;
          output = "|";
        }
        push({ type: "comma", value, output });
        continue;
      }
      if (value === "/") {
        if (prev.type === "dot" && state2.index === state2.start + 1) {
          state2.start = state2.index + 1;
          state2.consumed = "";
          state2.output = "";
          tokens.pop();
          prev = bos;
          continue;
        }
        push({ type: "slash", value, output: SLASH_LITERAL });
        continue;
      }
      if (value === ".") {
        if (state2.braces > 0 && prev.type === "dot") {
          if (prev.value === ".") prev.output = DOT_LITERAL;
          const brace = braces[braces.length - 1];
          prev.type = "dots";
          prev.output += value;
          prev.value += value;
          brace.dots = true;
          continue;
        }
        if (state2.braces + state2.parens === 0 && prev.type !== "bos" && prev.type !== "slash") {
          push({ type: "text", value, output: DOT_LITERAL });
          continue;
        }
        push({ type: "dot", value, output: DOT_LITERAL });
        continue;
      }
      if (value === "?") {
        const isGroup = prev && prev.value === "(";
        if (!isGroup && opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
          extglobOpen("qmark", value);
          continue;
        }
        if (prev && prev.type === "paren") {
          const next = peek();
          let output = value;
          if (prev.value === "(" && !/[!=<:]/.test(next) || next === "<" && !/<([!=]|\w+>)/.test(remaining())) {
            output = `\\${value}`;
          }
          push({ type: "text", value, output });
          continue;
        }
        if (opts.dot !== true && (prev.type === "slash" || prev.type === "bos")) {
          push({ type: "qmark", value, output: QMARK_NO_DOT });
          continue;
        }
        push({ type: "qmark", value, output: QMARK });
        continue;
      }
      if (value === "!") {
        if (opts.noextglob !== true && peek() === "(") {
          if (peek(2) !== "?" || !/[!=<:]/.test(peek(3))) {
            extglobOpen("negate", value);
            continue;
          }
        }
        if (opts.nonegate !== true && state2.index === 0) {
          negate();
          continue;
        }
      }
      if (value === "+") {
        if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
          extglobOpen("plus", value);
          continue;
        }
        if (prev && prev.value === "(" || opts.regex === false) {
          push({ type: "plus", value, output: PLUS_LITERAL });
          continue;
        }
        if (prev && (prev.type === "bracket" || prev.type === "paren" || prev.type === "brace") || state2.parens > 0) {
          push({ type: "plus", value });
          continue;
        }
        push({ type: "plus", value: PLUS_LITERAL });
        continue;
      }
      if (value === "@") {
        if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
          push({ type: "at", extglob: true, value, output: "" });
          continue;
        }
        push({ type: "text", value });
        continue;
      }
      if (value !== "*") {
        if (value === "$" || value === "^") {
          value = `\\${value}`;
        }
        const match = REGEX_NON_SPECIAL_CHARS.exec(remaining());
        if (match) {
          value += match[0];
          state2.index += match[0].length;
        }
        push({ type: "text", value });
        continue;
      }
      if (prev && (prev.type === "globstar" || prev.star === true)) {
        prev.type = "star";
        prev.star = true;
        prev.value += value;
        prev.output = star;
        state2.backtrack = true;
        state2.globstar = true;
        consume(value);
        continue;
      }
      let rest = remaining();
      if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
        extglobOpen("star", value);
        continue;
      }
      if (prev.type === "star") {
        if (opts.noglobstar === true) {
          consume(value);
          continue;
        }
        const prior = prev.prev;
        const before = prior.prev;
        const isStart = prior.type === "slash" || prior.type === "bos";
        const afterStar = before && (before.type === "star" || before.type === "globstar");
        if (opts.bash === true && (!isStart || rest[0] && rest[0] !== "/")) {
          push({ type: "star", value, output: "" });
          continue;
        }
        const isBrace = state2.braces > 0 && (prior.type === "comma" || prior.type === "brace");
        const isExtglob = extglobs.length && (prior.type === "pipe" || prior.type === "paren");
        if (!isStart && prior.type !== "paren" && !isBrace && !isExtglob) {
          push({ type: "star", value, output: "" });
          continue;
        }
        while (rest.slice(0, 3) === "/**") {
          const after = input[state2.index + 4];
          if (after && after !== "/") {
            break;
          }
          rest = rest.slice(3);
          consume("/**", 3);
        }
        if (prior.type === "bos" && eos()) {
          prev.type = "globstar";
          prev.value += value;
          prev.output = globstar(opts);
          state2.output = prev.output;
          state2.globstar = true;
          consume(value);
          continue;
        }
        if (prior.type === "slash" && prior.prev.type !== "bos" && !afterStar && eos()) {
          state2.output = state2.output.slice(0, -(prior.output + prev.output).length);
          prior.output = `(?:${prior.output}`;
          prev.type = "globstar";
          prev.output = globstar(opts) + (opts.strictSlashes ? ")" : "|$)");
          prev.value += value;
          state2.globstar = true;
          state2.output += prior.output + prev.output;
          consume(value);
          continue;
        }
        if (prior.type === "slash" && prior.prev.type !== "bos" && rest[0] === "/") {
          const end = rest[1] !== void 0 ? "|$" : "";
          state2.output = state2.output.slice(0, -(prior.output + prev.output).length);
          prior.output = `(?:${prior.output}`;
          prev.type = "globstar";
          prev.output = `${globstar(opts)}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
          prev.value += value;
          state2.output += prior.output + prev.output;
          state2.globstar = true;
          consume(value + advance());
          push({ type: "slash", value: "/", output: "" });
          continue;
        }
        if (prior.type === "bos" && rest[0] === "/") {
          prev.type = "globstar";
          prev.value += value;
          prev.output = `(?:^|${SLASH_LITERAL}|${globstar(opts)}${SLASH_LITERAL})`;
          state2.output = prev.output;
          state2.globstar = true;
          consume(value + advance());
          push({ type: "slash", value: "/", output: "" });
          continue;
        }
        state2.output = state2.output.slice(0, -prev.output.length);
        prev.type = "globstar";
        prev.output = globstar(opts);
        prev.value += value;
        state2.output += prev.output;
        state2.globstar = true;
        consume(value);
        continue;
      }
      const token = { type: "star", value, output: star };
      if (opts.bash === true) {
        token.output = ".*?";
        if (prev.type === "bos" || prev.type === "slash") {
          token.output = nodot + token.output;
        }
        push(token);
        continue;
      }
      if (prev && (prev.type === "bracket" || prev.type === "paren") && opts.regex === true) {
        token.output = value;
        push(token);
        continue;
      }
      if (state2.index === state2.start || prev.type === "slash" || prev.type === "dot") {
        if (prev.type === "dot") {
          state2.output += NO_DOT_SLASH;
          prev.output += NO_DOT_SLASH;
        } else if (opts.dot === true) {
          state2.output += NO_DOTS_SLASH;
          prev.output += NO_DOTS_SLASH;
        } else {
          state2.output += nodot;
          prev.output += nodot;
        }
        if (peek() !== "*") {
          state2.output += ONE_CHAR;
          prev.output += ONE_CHAR;
        }
      }
      push(token);
    }
    while (state2.brackets > 0) {
      if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "]"));
      state2.output = utils2.escapeLast(state2.output, "[");
      decrement("brackets");
    }
    while (state2.parens > 0) {
      if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", ")"));
      state2.output = utils2.escapeLast(state2.output, "(");
      decrement("parens");
    }
    while (state2.braces > 0) {
      if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "}"));
      state2.output = utils2.escapeLast(state2.output, "{");
      decrement("braces");
    }
    if (opts.strictSlashes !== true && (prev.type === "star" || prev.type === "bracket")) {
      push({ type: "maybe_slash", value: "", output: `${SLASH_LITERAL}?` });
    }
    if (state2.backtrack === true) {
      state2.output = "";
      for (const token of state2.tokens) {
        state2.output += token.output != null ? token.output : token.value;
        if (token.suffix) {
          state2.output += token.suffix;
        }
      }
    }
    return state2;
  };
  parse2.fastpaths = (input, options) => {
    const opts = { ...options };
    const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
    const len = input.length;
    if (len > max) {
      throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
    }
    input = REPLACEMENTS[input] || input;
    const {
      DOT_LITERAL,
      SLASH_LITERAL,
      ONE_CHAR,
      DOTS_SLASH,
      NO_DOT,
      NO_DOTS,
      NO_DOTS_SLASH,
      STAR,
      START_ANCHOR
    } = constants2.globChars(opts.windows);
    const nodot = opts.dot ? NO_DOTS : NO_DOT;
    const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
    const capture = opts.capture ? "" : "?:";
    const state2 = { negated: false, prefix: "" };
    let star = opts.bash === true ? ".*?" : STAR;
    if (opts.capture) {
      star = `(${star})`;
    }
    const globstar = (opts2) => {
      if (opts2.noglobstar === true) return star;
      return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
    };
    const create = (str) => {
      switch (str) {
        case "*":
          return `${nodot}${ONE_CHAR}${star}`;
        case ".*":
          return `${DOT_LITERAL}${ONE_CHAR}${star}`;
        case "*.*":
          return `${nodot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
        case "*/*":
          return `${nodot}${star}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star}`;
        case "**":
          return nodot + globstar(opts);
        case "**/*":
          return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star}`;
        case "**/*.*":
          return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
        case "**/.*":
          return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star}`;
        default: {
          const match = /^(.*?)\.(\w+)$/.exec(str);
          if (!match) return;
          const source2 = create(match[1]);
          if (!source2) return;
          return source2 + DOT_LITERAL + match[2];
        }
      }
    };
    const output = utils2.removePrefix(input, state2);
    let source = create(output);
    if (source && opts.strictSlashes !== true) {
      source += `${SLASH_LITERAL}?`;
    }
    return source;
  };
  parse_1 = parse2;
  return parse_1;
}
var picomatch_1$1;
var hasRequiredPicomatch$1;
function requirePicomatch$1() {
  if (hasRequiredPicomatch$1) return picomatch_1$1;
  hasRequiredPicomatch$1 = 1;
  const scan = /* @__PURE__ */ requireScan();
  const parse2 = /* @__PURE__ */ requireParse();
  const utils2 = /* @__PURE__ */ requireUtils();
  const constants2 = /* @__PURE__ */ requireConstants();
  const isObject2 = (val) => val && typeof val === "object" && !Array.isArray(val);
  const picomatch2 = (glob, options, returnState = false) => {
    if (Array.isArray(glob)) {
      const fns = glob.map((input) => picomatch2(input, options, returnState));
      const arrayMatcher = (str) => {
        for (const isMatch of fns) {
          const state3 = isMatch(str);
          if (state3) return state3;
        }
        return false;
      };
      return arrayMatcher;
    }
    const isState = isObject2(glob) && glob.tokens && glob.input;
    if (glob === "" || typeof glob !== "string" && !isState) {
      throw new TypeError("Expected pattern to be a non-empty string");
    }
    const opts = options || {};
    const posix = opts.windows;
    const regex = isState ? picomatch2.compileRe(glob, options) : picomatch2.makeRe(glob, options, false, true);
    const state2 = regex.state;
    delete regex.state;
    let isIgnored = () => false;
    if (opts.ignore) {
      const ignoreOpts = { ...options, ignore: null, onMatch: null, onResult: null };
      isIgnored = picomatch2(opts.ignore, ignoreOpts, returnState);
    }
    const matcher = (input, returnObject = false) => {
      const { isMatch, match, output } = picomatch2.test(input, regex, options, { glob, posix });
      const result = { glob, state: state2, regex, posix, input, output, match, isMatch };
      if (typeof opts.onResult === "function") {
        opts.onResult(result);
      }
      if (isMatch === false) {
        result.isMatch = false;
        return returnObject ? result : false;
      }
      if (isIgnored(input)) {
        if (typeof opts.onIgnore === "function") {
          opts.onIgnore(result);
        }
        result.isMatch = false;
        return returnObject ? result : false;
      }
      if (typeof opts.onMatch === "function") {
        opts.onMatch(result);
      }
      return returnObject ? result : true;
    };
    if (returnState) {
      matcher.state = state2;
    }
    return matcher;
  };
  picomatch2.test = (input, regex, options, { glob, posix } = {}) => {
    if (typeof input !== "string") {
      throw new TypeError("Expected input to be a string");
    }
    if (input === "") {
      return { isMatch: false, output: "" };
    }
    const opts = options || {};
    const format = opts.format || (posix ? utils2.toPosixSlashes : null);
    let match = input === glob;
    let output = match && format ? format(input) : input;
    if (match === false) {
      output = format ? format(input) : input;
      match = output === glob;
    }
    if (match === false || opts.capture === true) {
      if (opts.matchBase === true || opts.basename === true) {
        match = picomatch2.matchBase(input, regex, options, posix);
      } else {
        match = regex.exec(output);
      }
    }
    return { isMatch: Boolean(match), match, output };
  };
  picomatch2.matchBase = (input, glob, options) => {
    const regex = glob instanceof RegExp ? glob : picomatch2.makeRe(glob, options);
    return regex.test(utils2.basename(input));
  };
  picomatch2.isMatch = (str, patterns, options) => picomatch2(patterns, options)(str);
  picomatch2.parse = (pattern, options) => {
    if (Array.isArray(pattern)) return pattern.map((p) => picomatch2.parse(p, options));
    return parse2(pattern, { ...options, fastpaths: false });
  };
  picomatch2.scan = (input, options) => scan(input, options);
  picomatch2.compileRe = (state2, options, returnOutput = false, returnState = false) => {
    if (returnOutput === true) {
      return state2.output;
    }
    const opts = options || {};
    const prepend = opts.contains ? "" : "^";
    const append = opts.contains ? "" : "$";
    let source = `${prepend}(?:${state2.output})${append}`;
    if (state2 && state2.negated === true) {
      source = `^(?!${source}).*$`;
    }
    const regex = picomatch2.toRegex(source, options);
    if (returnState === true) {
      regex.state = state2;
    }
    return regex;
  };
  picomatch2.makeRe = (input, options = {}, returnOutput = false, returnState = false) => {
    if (!input || typeof input !== "string") {
      throw new TypeError("Expected a non-empty string");
    }
    let parsed = { negated: false, fastpaths: true };
    if (options.fastpaths !== false && (input[0] === "." || input[0] === "*")) {
      parsed.output = parse2.fastpaths(input, options);
    }
    if (!parsed.output) {
      parsed = parse2(input, options);
    }
    return picomatch2.compileRe(parsed, options, returnOutput, returnState);
  };
  picomatch2.toRegex = (source, options) => {
    try {
      const opts = options || {};
      return new RegExp(source, opts.flags || (opts.nocase ? "i" : ""));
    } catch (err) {
      if (options && options.debug === true) throw err;
      return /$^/;
    }
  };
  picomatch2.constants = constants2;
  picomatch_1$1 = picomatch2;
  return picomatch_1$1;
}
var picomatch_1;
var hasRequiredPicomatch;
function requirePicomatch() {
  if (hasRequiredPicomatch) return picomatch_1;
  hasRequiredPicomatch = 1;
  const pico = /* @__PURE__ */ requirePicomatch$1();
  const utils2 = /* @__PURE__ */ requireUtils();
  function picomatch2(glob, options, returnState = false) {
    if (options && (options.windows === null || options.windows === void 0)) {
      options = { ...options, windows: utils2.isWindows() };
    }
    return pico(glob, options, returnState);
  }
  Object.assign(picomatch2, pico);
  picomatch_1 = picomatch2;
  return picomatch_1;
}
var picomatchExports = /* @__PURE__ */ requirePicomatch();
const picomatch = /* @__PURE__ */ getDefaultExportFromCjs(picomatchExports);
const BROWSER_WAIT_OBSERVER = `function(selector,text,hidden){
  const element=selector===null?null:document.querySelector(selector);
  let visible=false;
  if(element){const style=getComputedStyle(element),rect=element.getBoundingClientRect();visible=!!(rect.width&&rect.height)&&style.visibility!=='hidden'&&style.display!=='none';}
  const found=text===null?true:(document.body?.innerText??'').includes(text);
  return {selector:selector===null?true:hidden?!visible:visible,text:text===null?true:hidden&&selector===null?!found:found,ready:document.readyState};
}`;
class BrowserConditionWait {
  constructor(page) {
    this.page = page;
    this.off = page.proxy.onEvent((event) => {
      const id2 = event.params.requestId, key = (event.sessionId ?? "") + "\0" + id2;
      if (event.method === "Network.requestWillBeSent" && typeof id2 === "string") {
        this.requests.add(key);
        this.lastNetwork = Date.now();
      }
      if ((event.method === "Network.loadingFinished" || event.method === "Network.loadingFailed") && typeof id2 === "string") {
        this.requests.delete(key);
        this.lastNetwork = Date.now();
      }
    });
    this.ready = page.proxy.send("Network.enable");
    void this.ready.catch(() => {
    });
    page.abort.signal.addEventListener("abort", () => this.off(), { once: true });
  }
  requests = /* @__PURE__ */ new Set();
  lastNetwork = Date.now();
  ready;
  off;
  async run(args, signal) {
    await this.ready;
    const timeout = Number(args.timeout ?? 25e3), until2 = Date.now() + timeout, selector = args.selector === void 0 ? null : String(args.selector), text2 = args.text === void 0 ? null : String(args.text), hidden = args.state === "hidden";
    const url2 = args.url === void 0 ? null : picomatch(String(args.url), { dot: true });
    while (true) {
      if (signal.aborted) throw signal.reason;
      try {
        const tree = await this.page.proxy.send("Page.getFrameTree");
        const world = await this.page.proxy.send("Page.createIsolatedWorld", { frameId: tree.frameTree.frame.id, worldName: "willyou-browser-observer-v1" });
        const observed = await this.page.proxy.send("Runtime.callFunctionOn", { executionContextId: world.executionContextId, functionDeclaration: BROWSER_WAIT_OBSERVER, arguments: [{ value: selector }, { value: text2 }, { value: hidden }], returnByValue: true });
        if (observed.exceptionDetails) throw new BrowserError("BROWSER_ERROR", "等待条件的选择器无效");
        const value = observed.result.value, load = args.load, loaded = load === void 0 || load === "domcontentloaded" && value?.ready !== "loading" || load === "load" && value?.ready === "complete" || load === "networkidle" && value?.ready === "complete" && this.requests.size === 0 && Date.now() - this.lastNetwork >= 500;
        if (value?.selector && value.text && (!url2 || url2(this.page.contents.getURL())) && loaded) return { waited: true };
      } catch (error2) {
        if (!(error2 instanceof Error && /execution context.*(?:destroyed|not found)|cannot find context|inspected target navigated/i.test(error2.message))) throw error2;
      }
      const remaining = until2 - Date.now();
      if (remaining <= 0) throw new BrowserError("BROWSER_TIMEOUT", `Wait timed out after ${timeout}ms`);
      try {
        await promises$1.setTimeout(Math.min(50, remaining), void 0, { signal });
      } catch {
        if (signal.aborted) throw signal.reason;
      }
    }
  }
}
const headers = record(string(), unknown()).transform((value) => Object.entries(value).map(([name, value2]) => ({ name, value: String(value2) })));
const responseValue = object({ status: number(), statusText: string(), headers, mimeType: string(), protocol: string().optional(), encodedDataLength: number().optional() });
const requestSchema = object({ requestId: string(), timestamp: number(), wallTime: number().optional(), request: object({ url: string(), method: string(), headers, postData: string().optional() }), redirectResponse: responseValue.optional() });
const responseSchema$1 = object({ requestId: string(), timestamp: number(), response: responseValue });
class BrowserRecorder {
  constructor(page) {
    this.page = page;
    this.off = page.proxy.onEvent((event) => {
      if (event.method === "Network.requestWillBeSent") {
        const parsed = requestSchema.safeParse(event.params);
        if (!parsed.success) return;
        const request = parsed.data;
        if (this.capture) {
          const key = (event.sessionId ?? "") + "\0" + request.requestId, previous = this.capture.get(key);
          if (previous && request.redirectResponse) {
            previous.response = { requestId: request.requestId, timestamp: request.timestamp, response: request.redirectResponse };
            previous.finished = request.timestamp;
          }
          const entry = { request };
          this.capture.set(key, entry);
          this.entries.push(entry);
        }
        if (this.matches?.(request.request.url)) this.intercepted.push({ requestId: request.requestId, url: request.request.url, method: request.request.method });
      } else if (event.method === "Network.responseReceived") {
        const parsed = responseSchema$1.safeParse(event.params);
        if (!parsed.success) return;
        const entry = this.capture?.get((event.sessionId ?? "") + "\0" + parsed.data.requestId);
        if (entry) entry.response = parsed.data;
      } else if (event.method === "Network.dataReceived") {
        const id2 = event.params.requestId, entry = typeof id2 === "string" ? this.capture?.get((event.sessionId ?? "") + "\0" + id2) : void 0;
        if (entry) {
          if (typeof event.params.dataLength === "number") entry.decodedBytes = (entry.decodedBytes ?? 0) + event.params.dataLength;
          if (typeof event.params.encodedDataLength === "number") entry.encodedBytes = (entry.encodedBytes ?? 0) + event.params.encodedDataLength;
        }
      } else if (event.method === "Network.loadingFinished" || event.method === "Network.loadingFailed") {
        const id2 = event.params.requestId, entry = typeof id2 === "string" ? this.capture?.get((event.sessionId ?? "") + "\0" + id2) : void 0;
        if (entry) {
          if (typeof event.params.timestamp === "number") entry.finished = event.params.timestamp;
          if (typeof event.params.encodedDataLength === "number") entry.transferBytes = event.params.encodedDataLength;
          if (typeof event.params.errorText === "string") entry.error = event.params.errorText;
        }
      }
    });
    page.abort.signal.addEventListener("abort", () => this.dispose(), { once: true });
  }
  capture = null;
  entries = [];
  pattern = null;
  matches = null;
  intercepted = [];
  off;
  async start(dispatched = () => {
  }) {
    if (this.capture) throw new ApplicationError("INVALID_INPUT", "此页面已在采集，请先capture stop");
    dispatched();
    await this.page.proxy.send("Network.enable");
    this.capture = /* @__PURE__ */ new Map();
    this.entries = [];
    return { capturing: true };
  }
  stop() {
    if (!this.capture) throw new ApplicationError("INVALID_INPUT", "此页面尚未开始采集");
    const entries = this.entries.map((entry) => {
      const { request, response: response2 } = entry, req = request.request, res = response2?.response, end = Math.max(entry.finished ?? request.timestamp, response2?.timestamp ?? request.timestamp), time2 = Math.max(0, (end - request.timestamp) * 1e3), wait = Math.max(0, ((response2?.timestamp ?? end) - request.timestamp) * 1e3);
      const url2 = new URL(req.url), postData = req.postData, bodySize = postData === void 0 ? 0 : Buffer.byteLength(postData);
      return {
        startedDateTime: new Date((request.wallTime ?? Date.now() / 1e3) * 1e3).toISOString(),
        time: time2,
        request: { method: req.method, url: req.url, httpVersion: res?.protocol ?? "HTTP/1.1", cookies: [], headers: req.headers, queryString: [...url2.searchParams].map(([name, value]) => ({ name, value })), headersSize: -1, bodySize, ...postData === void 0 ? {} : { postData: { mimeType: req.headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "application/octet-stream", text: postData } } },
        response: { status: res?.status ?? 0, statusText: res?.statusText ?? entry.error ?? "", httpVersion: res?.protocol ?? "HTTP/1.1", cookies: [], headers: res?.headers ?? [], content: { size: entry.decodedBytes ?? 0, mimeType: res?.mimeType ?? "" }, redirectURL: res?.headers.find((h) => h.name.toLowerCase() === "location")?.value ?? "", headersSize: -1, bodySize: entry.encodedBytes ?? -1, ...entry.transferBytes === void 0 ? {} : { _transferSize: entry.transferBytes } },
        cache: {},
        timings: { send: 0, wait, receive: Math.max(0, time2 - wait) }
      };
    });
    this.capture = null;
    this.entries = [];
    return { log: { version: "1.2", creator: { name: "WillYou", version: "0.1.1" }, entries } };
  }
  async enable(patterns) {
    const pattern = patterns[0] ?? "**/*", matches = picomatch(pattern, { dot: true });
    await this.page.proxy.send("Network.enable");
    this.pattern = pattern;
    this.matches = matches;
    this.intercepted = [];
    return { enabled: true, recordOnly: true, pattern, ignoredPatterns: patterns.slice(1) };
  }
  disable() {
    this.pattern = null;
    this.matches = null;
    return { enabled: false, recordOnly: true };
  }
  list() {
    return { pattern: this.pattern, requests: [...this.intercepted], recordOnly: true };
  }
  dispose() {
    this.off();
    this.capture = null;
    this.entries = [];
    this.intercepted = [];
    this.matches = null;
  }
}
const text$2 = (value) => {
  if (!["string", "number", "boolean"].includes(typeof value)) throw new ApplicationError("INVALID_INPUT", "Cookie字段须为文本");
  return String(value);
};
function cookieUrl(value) {
  let url2;
  try {
    url2 = new URL(text$2(value));
  } catch {
    throw new ApplicationError("INVALID_INPUT", "Cookie地址须为有效HTTP(S)地址");
  }
  if (!["http:", "https:"].includes(url2.protocol)) throw new ApplicationError("INVALID_INPUT", "Cookie地址须为有效HTTP(S)地址");
  return url2.href;
}
function browserCookieParameters(command, args, currentUrl) {
  if (command === "cookie get") return { method: "Network.getCookies", params: args.url === void 0 ? {} : { urls: [cookieUrl(args.url)] }, write: false };
  const name = text$2(args.name);
  if (!name || /[\s=;,\u0000-\u001f\u007f]/.test(name)) throw new ApplicationError("INVALID_INPUT", "Cookie名称无效");
  let domain;
  if (args.domain !== void 0) {
    domain = text$2(args.domain);
    let normalized;
    try {
      normalized = new URL("https://" + domain.replace(/^\./, "")).hostname;
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Cookie域名无效");
    }
    if (!domain || domain.replace(/^\./, "").toLowerCase() !== normalized || /[/:\\\s]/.test(domain)) throw new ApplicationError("INVALID_INPUT", "Cookie域名无效");
  }
  if (command === "cookie delete") return { method: "Network.deleteCookies", params: { name, ...domain ? { domain } : {}, ...args.url !== void 0 ? { url: cookieUrl(args.url) } : domain ? {} : { url: cookieUrl(currentUrl) } }, write: true };
  if (command !== "cookie set") throw new ApplicationError("CAPABILITY_UNAVAILABLE", "未登记的Cookie命令");
  const value = text$2(args.value), path2 = args.path === void 0 ? "/" : text$2(args.path), sameSite = args.sameSite === void 0 ? "lax" : text$2(args.sameSite).toLowerCase();
  if (/[\u0000-\u001f\u007f]/.test(value) || !path2.startsWith("/") || /[\u0000-\u001f\u007f]/.test(path2)) throw new ApplicationError("INVALID_INPUT", "Cookie值或路径包含不支持的字符");
  const sites2 = { lax: "Lax", strict: "Strict", none: "None" };
  if (!Object.hasOwn(sites2, sameSite)) throw new ApplicationError("INVALID_INPUT", "sameSite须为Lax、Strict或None");
  if (args.expires !== void 0 && (typeof args.expires !== "number" || !Number.isFinite(args.expires))) throw new ApplicationError("INVALID_INPUT", "expires须为有限Unix秒数");
  return { method: "Network.setCookie", params: { name, value, ...domain ? { domain } : { url: cookieUrl(currentUrl) }, path: path2, secure: args.secure === true, httpOnly: args.httpOnly === true, sameSite: sites2[sameSite], ...args.expires === void 0 ? {} : { expires: args.expires } }, write: true };
}
async function executeBrowserCookie(page, command, args, send) {
  const request = browserCookieParameters(command, args, page.contents.getURL());
  if (request.write) send();
  const result = await page.proxy.send(request.method, request.params);
  if (command === "cookie set" && result.success !== true) throw new BrowserError("BROWSER_ERROR", "Cookie未能保存，请核对域名、secure及sameSite");
  return { result: command === "cookie delete" ? { deleted: true } : result };
}
const browserIdentitySchema = _enum(["clean", "native"]);
const browserSettingsSchema = object({ searchEngine: _enum(["bing", "google", "duckduckgo", "kagi"]), identity: browserIdentitySchema, pendingIdentity: browserIdentitySchema.nullable() }).strict();
const KEY = "browserSettings.v1";
function browserUserAgent(native, mode) {
  return mode === "native" ? native : native.replace(/\s+(?:Electron|SmartDD|WillYou)\/[^\s]+/g, "");
}
class BrowserSettings {
  constructor(db2) {
    this.db = db2;
    const row = db2.prepare("SELECT value FROM app_settings WHERE key=?").get(KEY);
    try {
      if (row && Buffer.byteLength(row.value) > 4 * 1024 * 1024) throw Error();
      this.state = row ? browserSettingsSchema.parse(JSON.parse(row.value)) : { searchEngine: "bing", identity: "clean", pendingIdentity: null };
    } catch {
      throw new ApplicationError("BROWSER_UNAVAILABLE", "浏览器设置损坏；原数据已保留");
    }
    if (this.state.pendingIdentity !== null) this.save({ ...this.state, identity: this.state.pendingIdentity, pendingIdentity: null });
  }
  state;
  snapshot() {
    return { ...this.state };
  }
  save(next, dispatched = () => {
  }) {
    const parsed = browserSettingsSchema.parse(next), value = JSON.stringify(parsed);
    dispatched();
    this.db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(KEY, value, Date.now());
    this.state = parsed;
  }
  setIdentity(mode, reset = false, dispatched = () => {
  }) {
    const target = reset ? "clean" : mode;
    this.save({ ...this.state, pendingIdentity: target === this.state.identity ? null : target }, dispatched);
    return { mode: this.state.identity, pendingMode: this.state.pendingIdentity, restartRequired: this.state.pendingIdentity !== null };
  }
  setSearchEngine(searchEngine) {
    this.save({ ...this.state, searchEngine });
  }
}
function browserSiteOrigin(raw2) {
  try {
    const url2 = new URL(raw2);
    return ["http:", "https:"].includes(url2.protocol) ? url2.origin : null;
  } catch {
    return null;
  }
}
function browserCertificateHost(raw2) {
  try {
    const host2 = raw2.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const url2 = new URL("https://" + (host2.includes(":") ? "[" + host2 + "]" : host2));
    return url2.hostname.replace(/^\[|\]$/g, "") === host2 && url2.port === "" && url2.pathname === "/" && !url2.username && !url2.password && !url2.search && !url2.hash ? host2 : null;
  } catch {
    return null;
  }
}
const origin = string().refine((value) => browserSiteOrigin(value) === value, "站点须为规范HTTP(S)来源");
const host = string().refine((value) => browserCertificateHost(value) === value, "主机名无效");
const browserSiteStateSchema = object({ schemaVersion: literal(1), certificates: array(object({ host, createdAt: number().finite() }).strict()), permissions: array(object({ origin, permission: string().min(1).max(120), decision: _enum(["allow", "deny"]), updatedAt: number().finite() }).strict()) }).strict().superRefine((value, ctx) => {
  if (new Set(value.certificates.map((row) => row.host)).size !== value.certificates.length || new Set(value.permissions.map((row) => JSON.stringify([row.origin, row.permission]))).size !== value.permissions.length) ctx.addIssue({ code: "custom", message: "站点状态重复" });
});
class BrowserSiteStates {
  constructor(db2, knownProfile) {
    this.db = db2;
    this.knownProfile = knownProfile;
  }
  states = /* @__PURE__ */ new Map();
  key(id2) {
    return "browserProfileState.v1:" + id2;
  }
  read(id2) {
    if (!this.knownProfile(id2)) throw new ApplicationError("SCOPE_DENIED", "登录态不存在");
    const cached2 = this.states.get(id2);
    if (cached2) return cached2;
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key=?").get(this.key(id2));
    let state2;
    try {
      if (row && Buffer.byteLength(row.value) > 4 * 1024 * 1024) throw Error();
      state2 = row ? browserSiteStateSchema.parse(JSON.parse(row.value)) : { schemaVersion: 1, certificates: [], permissions: [] };
    } catch {
      throw new ApplicationError("BROWSER_UNAVAILABLE", "站点授权记录损坏；原记录已保留");
    }
    this.states.set(id2, state2);
    return state2;
  }
  snapshot(id2) {
    const state2 = this.read(id2);
    return { ...state2, certificates: state2.certificates.map((row) => ({ ...row })), permissions: state2.permissions.map((row) => ({ ...row })) };
  }
  save(id2, state2) {
    const parsed = browserSiteStateSchema.parse(state2), value = JSON.stringify(parsed);
    if (Buffer.byteLength(value) > 4 * 1024 * 1024) throw new ApplicationError("TOO_LARGE", "站点授权记录超过4MiB");
    this.db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(this.key(id2), value, Date.now());
    this.states.set(id2, parsed);
  }
  trusted(id2, hostname) {
    const host2 = browserCertificateHost(hostname);
    return host2 !== null && this.read(id2).certificates.some((row) => row.host === host2);
  }
  trust(id2, hostname) {
    const host2 = browserCertificateHost(hostname);
    if (!host2) throw new ApplicationError("INVALID_INPUT", "证书例外主机名无效");
    const state2 = this.read(id2);
    this.save(id2, { ...state2, certificates: [...state2.certificates.filter((row) => row.host !== host2), { host: host2, createdAt: Date.now() }] });
  }
  revokeCertificate(id2, hostname) {
    const host2 = browserCertificateHost(hostname);
    if (!host2) throw new ApplicationError("INVALID_INPUT", "主机名无效");
    const state2 = this.read(id2);
    this.save(id2, { ...state2, certificates: state2.certificates.filter((row) => row.host !== host2) });
  }
  permission(id2, url2, name) {
    const origin2 = browserSiteOrigin(url2);
    if (origin2 === null) return null;
    return this.read(id2).permissions.find((row) => row.origin === origin2 && row.permission === name)?.decision ?? null;
  }
  decide(id2, url2, names, decision) {
    const origin2 = browserSiteOrigin(url2);
    if (origin2 === null || !names.length || names.length > 16 || names.some((name) => !name || name.length > 120)) throw new ApplicationError("INVALID_INPUT", "站点权限请求无效");
    const state2 = this.read(id2), permissions = state2.permissions.filter((row) => row.origin !== origin2 || !names.includes(row.permission));
    for (const permission of new Set(names)) permissions.push({ origin: origin2, permission, decision, updatedAt: Date.now() });
    this.save(id2, { ...state2, permissions });
  }
  revokePermission(id2, url2, permission) {
    const origin2 = browserSiteOrigin(url2);
    if (origin2 === null) throw new ApplicationError("INVALID_INPUT", "站点无效");
    const state2 = this.read(id2);
    this.save(id2, { ...state2, permissions: state2.permissions.filter((row) => row.origin !== origin2 || row.permission !== permission) });
  }
  forget(id2) {
    this.db.prepare("DELETE FROM app_settings WHERE key=?").run(this.key(id2));
    this.states.delete(id2);
  }
}
class BrowserNetworkPolicy {
  constructor(options) {
    this.options = options;
  }
  sessions = /* @__PURE__ */ new Map();
  contents = /* @__PURE__ */ new Map();
  suspended = /* @__PURE__ */ new Map();
  endpoint(raw2) {
    try {
      const url2 = new URL(raw2), host2 = browserCertificateHost(url2.hostname);
      return url2.protocol === "https:" && host2 ? { endpoint: url2.origin, host: host2 } : null;
    } catch {
      return null;
    }
  }
  trusted(profileId, host2) {
    try {
      return this.options.trusted(profileId, host2);
    } catch {
      return false;
    }
  }
  install(contents, profileId) {
    const old = this.contents.get(contents);
    if (old) {
      if (old.profileId !== profileId) throw Error("Browser contents profile changed without replacing its engine");
      return;
    }
    const session = contents.session, existing = this.sessions.get(session);
    if (existing && existing.profileId !== profileId) throw Error("Browser profiles cannot share a native session");
    if (!existing) {
      const state2 = { profileId, accepted: /* @__PURE__ */ new Map() };
      this.sessions.set(session, state2);
      session.webRequest.onBeforeRequest((details, callback) => {
        if (this.suspended.has(profileId)) {
          callback({ cancel: true });
          return;
        }
        const endpoint = this.endpoint(details.url), accepted = endpoint && state2.accepted.get(endpoint.endpoint);
        if (accepted && endpoint && !this.trusted(profileId, endpoint.host)) {
          if (details.resourceType === "mainFrame") {
            const target = [...this.contents].find(([wc, entry]) => entry.profileId === profileId && !wc.isDestroyed() && wc.id === (details.webContentsId ?? details.webContents?.id))?.[0];
            if (target) try {
              this.options.failed?.(target, { ...accepted, url: details.url });
            } catch {
            }
          }
          callback({ cancel: true });
          return;
        }
        callback({ cancel: false });
      });
    }
    const listener = (event, url2, error2, _certificate, callback, isMainFrame) => {
      event.preventDefault();
      const endpoint = this.endpoint(url2), allowed = !contents.isDestroyed() && !this.suspended.has(profileId) && endpoint !== null && this.trusted(profileId, endpoint.host);
      if (endpoint) {
        const failure2 = { url: url2, host: endpoint.host, error: error2 };
        if (allowed) this.sessions.get(session).accepted.set(endpoint.endpoint, failure2);
        else if (isMainFrame) try {
          this.options.failed?.(contents, failure2);
        } catch {
        }
      }
      callback(allowed);
    };
    const destroyed = () => {
      this.contents.delete(contents);
    };
    this.contents.set(contents, { profileId, listener, destroyed });
    contents.on("certificate-error", listener);
    contents.once("destroyed", destroyed);
  }
  /** Use alongside the profile lifecycle lock. Nested operations cannot clear
   * each other's gate. New contents in the same profile are blocked as well. */
  suspend(profileId) {
    this.suspended.set(profileId, (this.suspended.get(profileId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.suspended.get(profileId) ?? 1) - 1;
      if (count) this.suspended.set(profileId, count);
      else this.suspended.delete(profileId);
    };
  }
  certificate(contents, url2) {
    const scope2 = this.contents.get(contents), endpoint = this.endpoint(url2);
    if (!scope2 || !endpoint || !this.trusted(scope2.profileId, endpoint.host)) return null;
    const accepted = this.sessions.get(contents.session)?.accepted.get(endpoint.endpoint);
    return accepted ? { ...accepted, url: url2 } : null;
  }
  dispose() {
    for (const [contents, { listener, destroyed }] of this.contents) if (!contents.isDestroyed()) {
      contents.off("certificate-error", listener);
      contents.off("destroyed", destroyed);
    }
    for (const session of this.sessions.keys()) session.webRequest.onBeforeRequest(null);
    this.contents.clear();
    this.sessions.clear();
    this.suspended.clear();
  }
}
const keys = (permission, media) => permission === "media" && media?.length ? [...new Set(media)].map((type) => "media:" + type) : [permission];
class BrowserPermissions {
  constructor(options) {
    this.options = options;
  }
  sessions = /* @__PURE__ */ new Map();
  owners = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  detach = /* @__PURE__ */ new Map();
  available(profileId) {
    try {
      return this.options.available(profileId);
    } catch {
      return false;
    }
  }
  decision(profileId, origin2, names) {
    try {
      const choices = names.map((name) => this.options.states.permission(profileId, origin2, name));
      return choices.includes("deny") ? false : choices.every((value) => value === "allow") ? true : null;
    } catch {
      return false;
    }
  }
  install(owner) {
    const { contents, profileId } = owner, session = contents.session, previous = this.owners.get(contents);
    if (previous) {
      if (previous.profileId !== profileId || previous.pageId !== owner.pageId || previous.taskId !== owner.taskId) throw Error("Permission owner changed without replacing contents");
      return;
    }
    const existing = this.sessions.get(session);
    if (existing && existing !== profileId) throw Error("Permission profiles cannot share a session");
    if (!existing) {
      this.sessions.set(session, profileId);
      session.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
        const scope2 = wc ? this.owners.get(wc) : null;
        if (wc && (!scope2 || scope2.profileId !== profileId) || !this.available(profileId)) return false;
        const origin2 = browserSiteOrigin(details.requestingUrl ?? details.securityOrigin ?? requestingOrigin);
        if (!origin2) return false;
        return this.decision(profileId, origin2, keys(permission, details.mediaType && details.mediaType !== "unknown" ? [details.mediaType] : void 0)) === true;
      });
      session.setPermissionRequestHandler((wc, permission, callback, details) => {
        const scope2 = this.owners.get(wc), origin2 = browserSiteOrigin(details.requestingUrl);
        if (!scope2 || scope2.profileId !== profileId || scope2.contents.isDestroyed() || !origin2 || !this.available(profileId)) {
          callback(false);
          return;
        }
        const names = keys(permission, "mediaTypes" in details ? details.mediaTypes : void 0), decision = this.decision(profileId, origin2, names);
        if (decision !== null) {
          callback(decision);
          return;
        }
        if (this.pending.size >= 64) {
          callback(false);
          return;
        }
        const id2 = node_crypto.randomUUID();
        this.pending.set(id2, { owner: scope2, prompt: { id: id2, pageId: scope2.pageId, profileId, origin: origin2, permissions: names }, callback });
        this.options.changed?.(scope2.taskId);
      });
    }
    this.owners.set(contents, owner);
    const cancel = () => this.cancel(contents), navigation = (_event, _url2, inPlace) => {
      if (!inPlace) cancel();
    };
    const destroyed = () => {
      cancel();
      this.owners.delete(contents);
      this.detach.delete(contents);
    };
    contents.on("did-start-navigation", navigation);
    contents.on("render-process-gone", cancel);
    contents.once("destroyed", destroyed);
    this.detach.set(contents, () => {
      contents.off("did-start-navigation", navigation);
      contents.off("render-process-gone", cancel);
      contents.off("destroyed", destroyed);
    });
  }
  snapshot(taskId, pageId) {
    const value = [...this.pending.values()].find((value2) => value2.owner.taskId === taskId && (value2.owner.pageId === pageId || value2.owner.displayPageId === pageId))?.prompt;
    return value ? { ...value, permissions: [...value.permissions] } : null;
  }
  respond(taskId, id2, allow) {
    const value = this.pending.get(id2);
    if (!value || value.owner.taskId !== taskId) throw new ApplicationError("RESOURCE_STATE_CHANGED", "站点权限提示已失效");
    if (value.owner.contents.isDestroyed() || this.owners.get(value.owner.contents) !== value.owner || !this.available(value.owner.profileId)) {
      this.pending.delete(id2);
      value.callback(false);
      this.options.changed?.(taskId);
      throw new ApplicationError("RESOURCE_STATE_CHANGED", "页面或登录态已变化，请重新请求权限");
    }
    this.options.states.decide(value.owner.profileId, value.prompt.origin, value.prompt.permissions, allow ? "allow" : "deny");
    this.pending.delete(id2);
    try {
      value.callback(allow);
    } finally {
      this.options.changed?.(taskId);
    }
  }
  cancel(contents) {
    for (const [id2, value] of this.pending) if (value.owner.contents === contents) {
      this.pending.delete(id2);
      try {
        value.callback(false);
      } catch {
      } finally {
        this.options.changed?.(value.owner.taskId);
      }
    }
  }
  dispose() {
    for (const contents of this.owners.keys()) this.cancel(contents);
    for (const [contents, detach] of this.detach) if (!contents.isDestroyed()) detach();
    for (const session of this.sessions.keys()) {
      session.setPermissionRequestHandler(null);
      session.setPermissionCheckHandler(null);
    }
    this.pending.clear();
    this.owners.clear();
    this.detach.clear();
    this.sessions.clear();
  }
}
function browserDownloadFilename(raw2) {
  return (raw2.replaceAll("\\", "/").split("/").at(-1) ?? "").replace(new RegExp("\\p{Cc}", "gu"), "").replace(/[<>:"|?*]/g, "_").replace(/[. ]+$/g, "") || "download";
}
function browserDownloadCandidate(name, attempt) {
  if (attempt === 0) return name;
  const dot = name.lastIndexOf("."), extension = dot > 0 ? name.slice(dot) : "", stem = extension ? name.slice(0, -extension.length) : name;
  return `${stem} (${attempt})${extension}`;
}
class BrowserDownloadReservations {
  constructor(directory, exists = node_fs.existsSync) {
    this.directory = directory;
    this.exists = exists;
  }
  reserved = /* @__PURE__ */ new Set();
  key(path2) {
    return node_path.resolve(path2).normalize("NFC").toLocaleLowerCase("en-US");
  }
  reserve(raw2) {
    const name = browserDownloadFilename(raw2), directory = this.directory();
    for (let attempt = 0; attempt < 1e3; attempt++) {
      const candidate = browserDownloadCandidate(name, attempt), path2 = node_path.join(directory, candidate), key = this.key(path2);
      if (this.reserved.has(key) || this.exists(path2)) continue;
      this.reserved.add(key);
      let released = false;
      return { name: candidate, path: path2, release: () => {
        if (!released) {
          released = true;
          this.reserved.delete(key);
        }
      } };
    }
    throw new ApplicationError("RESOURCE_BUSY", "无法在系统下载目录选择不重名的文件（已尝试1000次）");
  }
  explicit(path2) {
    const key = this.key(path2);
    if (this.reserved.has(key)) throw new ApplicationError("RESOURCE_BUSY", "此路径正在被另一条下载使用");
    this.reserved.add(key);
    let released = false;
    return { name: node_path.basename(path2), path: path2, release: () => {
      if (!released) {
        released = true;
        this.reserved.delete(key);
      }
    } };
  }
}
class BrowserDownloads {
  constructor(options) {
    this.options = options;
    this.destinations = new BrowserDownloadReservations(options.directory);
  }
  owners = /* @__PURE__ */ new Map();
  detachOwners = /* @__PURE__ */ new Map();
  sessions = /* @__PURE__ */ new Map();
  records = /* @__PURE__ */ new Map();
  live = /* @__PURE__ */ new Map();
  expected = /* @__PURE__ */ new Map();
  expectations = /* @__PURE__ */ new Set();
  closed = false;
  destinations;
  changed(record2) {
    record2.updatedAt = Date.now();
    if (!this.closed) this.options.changed?.(record2.taskId);
  }
  install(owner) {
    const existing = this.owners.get(owner.contents);
    if (existing) {
      if (existing.taskId !== owner.taskId || existing.pageId !== owner.pageId || existing.profileId !== owner.profileId) throw Error("Download owner changed");
      return;
    }
    this.owners.set(owner.contents, owner);
    const destroyed = () => {
      this.owners.delete(owner.contents);
      this.detachOwners.delete(owner.contents);
      for (const expected of this.expectations) if (expected.contents === owner.contents) expected.fail(new BrowserError("BROWSER_TAB_CLOSED", "下载期间网页已关闭"));
    };
    owner.contents.once("destroyed", destroyed);
    this.detachOwners.set(owner.contents, () => owner.contents.off("destroyed", destroyed));
    const session = owner.contents.session;
    if (this.sessions.has(session)) return;
    const listener = (event, item, contents) => {
      const source = this.owners.get(contents);
      let available = false;
      try {
        available = !!source && !source.contents.isDestroyed() && this.options.available(source.profileId, source.taskId);
      } catch {
      }
      if (this.closed || !source || !available) {
        event.preventDefault();
        this.expected.get(contents)?.fail(new BrowserError("BROWSER_UNAVAILABLE", "下载来源页面或登录态不可用"));
        return;
      }
      const safe = (read, fallback) => {
        try {
          return read();
        } catch {
          return fallback;
        }
      };
      const pending = this.expected.get(contents), expected = pending?.active ? pending : void 0;
      if (expected) this.expected.delete(contents);
      const id2 = node_crypto.randomUUID(), record2 = { id: id2, taskId: source.taskId, pageId: source.pageId, name: browserDownloadFilename(safe(() => item.getFilename(), "download")), path: null, destination: expected ? "explicit" : "downloads", url: safe(() => item.getURL(), ""), state: "progress", receivedBytes: 0, totalBytes: Math.max(0, safe(() => item.getTotalBytes(), 0)), updatedAt: Date.now(), error: null };
      this.records.set(id2, record2);
      if (expected) expected.recordId = id2;
      let release = () => {
      };
      try {
        const reservation = expected ? this.destinations.explicit(expected.path) : this.destinations.reserve(record2.name);
        release = reservation.release;
        record2.name = reservation.name;
        record2.path = reservation.path;
        item.setSavePath(reservation.path);
      } catch (error2) {
        release();
        event.preventDefault();
        record2.state = "failed";
        record2.error = error2 instanceof Error ? error2.message : String(error2);
        this.changed(record2);
        expected?.fail(error2);
        return;
      }
      const updated = () => {
        record2.receivedBytes = safe(() => item.getReceivedBytes(), record2.receivedBytes);
        record2.totalBytes = Math.max(0, safe(() => item.getTotalBytes(), record2.totalBytes));
        this.changed(record2);
      };
      const done = (_event, state2) => {
        updated();
        record2.state = state2 === "completed" ? "done" : state2 === "cancelled" ? "cancelled" : "failed";
        record2.error = state2 === "interrupted" ? "下载连接被中断" : null;
        record2.path = safe(() => item.getSavePath(), record2.path ?? "") || record2.path;
        release();
        item.off("updated", updated);
        this.live.delete(id2);
        this.changed(record2);
        if (record2.state === "done") expected?.complete(record2);
        else expected?.fail(new BrowserError("BROWSER_ERROR", record2.state === "cancelled" ? "下载已取消" : "下载连接被中断"));
      };
      item.on("updated", updated);
      item.once("done", done);
      this.live.set(id2, { item, detach: () => {
        item.off("updated", updated);
        item.off("done", done);
        release();
      } });
      this.changed(record2);
    };
    session.on("will-download", listener);
    this.sessions.set(session, listener);
  }
  snapshot(taskId) {
    return [...this.records.values()].filter((record2) => record2.taskId === taskId).reverse().map((record2) => ({ ...record2 }));
  }
  /** Arm before a guarded click; start only at its actual dispatch. The first
   * native event from this page consumes the override, never later downloads. */
  expect(contents, path2, signal) {
    if (this.closed || !this.owners.has(contents) || contents.isDestroyed()) throw new BrowserError("BROWSER_TAB_CLOSED", "网页已关闭");
    if (!node_path.isAbsolute(path2) || path2.includes("\0") || !node_path.basename(path2)) throw new ApplicationError("INVALID_INPUT", "下载保存路径无效");
    if (this.expected.has(contents)) throw new ApplicationError("RESOURCE_BUSY", "本页已有下载正在等待触发");
    let accept, reject, settled = false;
    const result = new Promise((yes, no) => {
      accept = yes;
      reject = no;
    });
    void result.catch(() => {
    });
    const finish = (error2, record2) => {
      if (settled) return;
      settled = true;
      if (this.expected.get(contents) === entry) this.expected.delete(contents);
      this.expectations.delete(entry);
      signal.removeEventListener("abort", aborted2);
      if (record2) accept({ ...record2 });
      else {
        const item = entry.recordId ? this.live.get(entry.recordId)?.item : void 0;
        try {
          item?.cancel();
        } catch {
        }
        reject(error2);
      }
    };
    const entry = { contents, path: path2, active: false, complete: (record2) => finish(null, record2), fail: (error2) => finish(error2) };
    const aborted2 = () => entry.fail(signal.reason ?? new ApplicationError("CANCELED", "下载操作已取消"));
    this.expected.set(contents, entry);
    this.expectations.add(entry);
    signal.addEventListener("abort", aborted2, { once: true });
    if (signal.aborted) aborted2();
    return { result, start: () => {
      if (settled) throw signal.reason ?? new ApplicationError("CANCELED", "下载操作已取消");
      entry.active = true;
    }, claimed: () => entry.recordId !== void 0, cancel: (error2) => entry.fail(error2) };
  }
  async action(taskId, id2, action) {
    const record2 = this.records.get(id2);
    if (!record2 || record2.taskId !== taskId) throw new ApplicationError("SCOPE_DENIED", "没有此任务的下载记录");
    if (action === "cancel") {
      this.live.get(id2)?.item.cancel();
      return;
    }
    if (action === "remove") {
      if (this.live.has(id2)) throw new ApplicationError("RESOURCE_BUSY", "请先取消正在进行的下载");
      this.records.delete(id2);
      this.changed(record2);
      return;
    }
    if (record2.state !== "done" || !record2.path) throw new ApplicationError("RESOURCE_STATE_CHANGED", "下载尚未完成");
    if (action === "reveal") electron.shell.showItemInFolder(record2.path);
    else {
      const error2 = await electron.shell.openPath(record2.path);
      if (error2) throw new ApplicationError("BROWSER_ERROR", error2);
    }
  }
  dispose() {
    this.closed = true;
    for (const expected of this.expectations) expected.fail(new BrowserError("BROWSER_UNAVAILABLE", "浏览器服务已关闭"));
    for (const { item, detach } of this.live.values()) {
      try {
        item.cancel();
      } catch {
      }
      detach();
    }
    for (const [session, listener] of this.sessions) session.off("will-download", listener);
    for (const [contents, detach] of this.detachOwners) if (!contents.isDestroyed()) detach();
    this.live.clear();
    this.sessions.clear();
    this.owners.clear();
    this.detachOwners.clear();
    this.expected.clear();
  }
}
class BrowserAuthentication {
  constructor(options) {
    this.options = options;
  }
  owners = /* @__PURE__ */ new Map();
  configured = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  cancelled = /* @__PURE__ */ new Map();
  detach = /* @__PURE__ */ new Map();
  available(id2) {
    try {
      return this.options.available(id2);
    } catch {
      return false;
    }
  }
  install(owner) {
    const wc = owner.contents, previous = this.owners.get(wc);
    if (previous) {
      if (previous.taskId !== owner.taskId || previous.profileId !== owner.profileId || previous.pageId !== owner.pageId) throw Error("Authentication owner changed");
      return;
    }
    this.owners.set(wc, owner);
    const login = (_event, response2, info, callback) => {
      _event.preventDefault();
      if (wc.isDestroyed() || !this.available(owner.profileId)) {
        callback();
        return;
      }
      let url2;
      try {
        url2 = new URL(response2.url);
        if (!["http:", "https:"].includes(url2.protocol)) throw Error();
        url2.username = "";
        url2.password = "";
      } catch {
        callback();
        return;
      }
      const credentials = this.configured.get(wc);
      if (credentials && !info.isProxy && response2.firstAuthAttempt && !this.snapshot(owner.taskId, owner.pageId)) {
        callback(credentials.user, credentials.pass);
        return;
      }
      const id2 = node_crypto.randomUUID(), prompt = { id: id2, pageId: owner.pageId, profileId: owner.profileId, url: url2.href, host: info.isProxy ? info.host + ":" + info.port : url2.host, realm: info.realm, proxy: info.isProxy };
      this.pending.set(id2, { owner, prompt, callback });
      this.cancelled.delete(wc);
      this.options.changed?.(owner.taskId);
    };
    const navigation = (_event, _url2, inPlace) => {
      if (!inPlace) {
        this.cancel(wc);
        this.cancelled.delete(wc);
        for (const target of this.cancelled.keys()) if (this.owners.get(target)?.displayPageId === owner.pageId) this.cancelled.delete(target);
      }
    };
    const gone = () => this.cancel(wc), destroyed = () => {
      this.cancel(wc);
      this.configured.delete(wc);
      this.cancelled.delete(wc);
      this.owners.delete(wc);
      this.detach.delete(wc);
    };
    wc.on("login", login);
    wc.on("did-start-navigation", navigation);
    wc.on("render-process-gone", gone);
    wc.once("destroyed", destroyed);
    this.detach.set(wc, () => {
      wc.off("login", login);
      wc.off("did-start-navigation", navigation);
      wc.off("render-process-gone", gone);
      wc.off("destroyed", destroyed);
    });
  }
  snapshot(taskId, pageId) {
    const prompt = [...this.pending.values()].find((value) => value.owner.taskId === taskId && (value.owner.pageId === pageId || value.owner.displayPageId === pageId))?.prompt;
    return prompt ? { ...prompt } : null;
  }
  cancelledState(taskId, pageId) {
    const value = [...this.cancelled.entries()].reverse().find(([wc]) => {
      const owner = this.owners.get(wc);
      return owner?.taskId === taskId && (owner.pageId === pageId || owner.displayPageId === pageId);
    })?.[1];
    return value ? { ...value } : null;
  }
  cancelledForPage(taskId, pageId) {
    const owner = [...this.owners.values()].find((owner2) => owner2.taskId === taskId && owner2.pageId === pageId), value = owner ? this.cancelled.get(owner.contents) : void 0;
    return value ? { ...value } : null;
  }
  setCredentials(contents, user, pass, dispatched = () => {
  }) {
    const owner = this.owners.get(contents);
    if (!owner || contents.isDestroyed() || !this.available(owner.profileId)) throw new ApplicationError("BROWSER_UNAVAILABLE", "认证页面或登录态不可用");
    if (this.snapshot(owner.taskId, owner.pageId)) throw new ApplicationError("RESOURCE_BUSY", "页面正在等待用户处理基本认证，Agent不能代答当前提示");
    dispatched();
    this.configured.set(contents, { user, pass });
  }
  respond(taskId, id2, credentials) {
    const request = this.pending.get(id2);
    if (!request || request.owner.taskId !== taskId) throw new ApplicationError("RESOURCE_STATE_CHANGED", "基本认证提示已失效");
    const { owner, prompt, callback } = request;
    if (owner.contents.isDestroyed() || this.owners.get(owner.contents) !== owner || !this.available(owner.profileId)) {
      this.pending.delete(id2);
      callback();
      this.options.changed?.(taskId);
      throw new ApplicationError("RESOURCE_STATE_CHANGED", "认证页面或登录态已变化");
    }
    this.pending.delete(id2);
    this.configured.delete(owner.contents);
    if (!credentials) this.cancelled.set(owner.contents, { pageId: owner.pageId, url: prompt.url, host: prompt.host });
    else this.cancelled.delete(owner.contents);
    try {
      if (credentials) callback(credentials.user, credentials.pass);
      else callback();
    } finally {
      this.options.changed?.(taskId);
    }
  }
  cancel(contents) {
    for (const [id2, request] of this.pending) if (request.owner.contents === contents) {
      this.pending.delete(id2);
      try {
        request.callback();
      } catch {
      } finally {
        this.options.changed?.(request.owner.taskId);
      }
    }
  }
  dispose() {
    for (const contents of this.owners.keys()) this.cancel(contents);
    for (const [contents, detach] of this.detach) if (!contents.isDestroyed()) detach();
    this.owners.clear();
    this.configured.clear();
    this.pending.clear();
    this.cancelled.clear();
    this.detach.clear();
  }
}
const entityKind = Symbol.for("drizzle:entityKind");
function is(value, type) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (value instanceof type) {
    return true;
  }
  if (!Object.prototype.hasOwnProperty.call(type, entityKind)) {
    throw new Error(
      `Class "${type.name ?? "<unknown>"}" doesn't look like a Drizzle entity. If this is incorrect and the class is provided by Drizzle, please report this as a bug.`
    );
  }
  let cls = value.constructor;
  if (cls) {
    while (cls) {
      if (entityKind in cls && cls[entityKind] === type[entityKind]) {
        return true;
      }
      cls = Object.getPrototypeOf(cls);
    }
  }
  return false;
}
class Column {
  constructor(table, config2) {
    this.table = table;
    this.config = config2;
    this.name = config2.name;
    this.notNull = config2.notNull;
    this.default = config2.default;
    this.defaultFn = config2.defaultFn;
    this.onUpdateFn = config2.onUpdateFn;
    this.hasDefault = config2.hasDefault;
    this.primary = config2.primaryKey;
    this.isUnique = config2.isUnique;
    this.uniqueName = config2.uniqueName;
    this.uniqueType = config2.uniqueType;
    this.dataType = config2.dataType;
    this.columnType = config2.columnType;
    this.generated = config2.generated;
    this.generatedIdentity = config2.generatedIdentity;
  }
  static [entityKind] = "Column";
  name;
  primary;
  notNull;
  default;
  defaultFn;
  onUpdateFn;
  hasDefault;
  isUnique;
  uniqueName;
  uniqueType;
  dataType;
  columnType;
  enumValues = void 0;
  generated = void 0;
  generatedIdentity = void 0;
  config;
  mapFromDriverValue(value) {
    return value;
  }
  mapToDriverValue(value) {
    return value;
  }
  // ** @internal */
  shouldDisableInsert() {
    return this.config.generated !== void 0 && this.config.generated.type !== "byDefault";
  }
}
class ColumnBuilder {
  static [entityKind] = "ColumnBuilder";
  config;
  constructor(name, dataType, columnType) {
    this.config = {
      name,
      notNull: false,
      default: void 0,
      hasDefault: false,
      primaryKey: false,
      isUnique: false,
      uniqueName: void 0,
      uniqueType: void 0,
      dataType,
      columnType,
      generated: void 0
    };
  }
  /**
   * Changes the data type of the column. Commonly used with `json` columns. Also, useful for branded types.
   *
   * @example
   * ```ts
   * const users = pgTable('users', {
   * 	id: integer('id').$type<UserId>().primaryKey(),
   * 	details: json('details').$type<UserDetails>().notNull(),
   * });
   * ```
   */
  $type() {
    return this;
  }
  /**
   * Adds a `not null` clause to the column definition.
   *
   * Affects the `select` model of the table - columns *without* `not null` will be nullable on select.
   */
  notNull() {
    this.config.notNull = true;
    return this;
  }
  /**
   * Adds a `default <value>` clause to the column definition.
   *
   * Affects the `insert` model of the table - columns *with* `default` are optional on insert.
   *
   * If you need to set a dynamic default value, use {@link $defaultFn} instead.
   */
  default(value) {
    this.config.default = value;
    this.config.hasDefault = true;
    return this;
  }
  /**
   * Adds a dynamic default value to the column.
   * The function will be called when the row is inserted, and the returned value will be used as the column value.
   *
   * **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
   */
  $defaultFn(fn) {
    this.config.defaultFn = fn;
    this.config.hasDefault = true;
    return this;
  }
  /**
   * Alias for {@link $defaultFn}.
   */
  $default = this.$defaultFn;
  /**
   * Adds a dynamic update value to the column.
   * The function will be called when the row is updated, and the returned value will be used as the column value if none is provided.
   * If no `default` (or `$defaultFn`) value is provided, the function will be called when the row is inserted as well, and the returned value will be used as the column value.
   *
   * **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
   */
  $onUpdateFn(fn) {
    this.config.onUpdateFn = fn;
    this.config.hasDefault = true;
    return this;
  }
  /**
   * Alias for {@link $onUpdateFn}.
   */
  $onUpdate = this.$onUpdateFn;
  /**
   * Adds a `primary key` clause to the column definition. This implicitly makes the column `not null`.
   *
   * In SQLite, `integer primary key` implicitly makes the column auto-incrementing.
   */
  primaryKey() {
    this.config.primaryKey = true;
    this.config.notNull = true;
    return this;
  }
}
const TableName = Symbol.for("drizzle:Name");
const Schema = Symbol.for("drizzle:Schema");
const Columns = Symbol.for("drizzle:Columns");
const ExtraConfigColumns = Symbol.for("drizzle:ExtraConfigColumns");
const OriginalName = Symbol.for("drizzle:OriginalName");
const BaseName = Symbol.for("drizzle:BaseName");
const IsAlias = Symbol.for("drizzle:IsAlias");
const ExtraConfigBuilder = Symbol.for("drizzle:ExtraConfigBuilder");
class Table {
  static [entityKind] = "Table";
  /** @internal */
  static Symbol = {
    Name: TableName,
    Schema,
    OriginalName,
    Columns,
    ExtraConfigColumns,
    BaseName,
    IsAlias,
    ExtraConfigBuilder
  };
  /**
   * @internal
   * Can be changed if the table is aliased.
   */
  [TableName];
  /**
   * @internal
   * Used to store the original name of the table, before any aliasing.
   */
  [OriginalName];
  /** @internal */
  [Schema];
  /** @internal */
  [Columns];
  /** @internal */
  [ExtraConfigColumns];
  /**
   *  @internal
   * Used to store the table name before the transformation via the `tableCreator` functions.
   */
  [BaseName];
  /** @internal */
  [IsAlias] = false;
  /** @internal */
  [ExtraConfigBuilder] = void 0;
  constructor(name, schema, baseName) {
    this[TableName] = this[OriginalName] = name;
    this[Schema] = schema;
    this[BaseName] = baseName;
  }
}
const isPgEnumSym = Symbol.for("drizzle:isPgEnum");
function isPgEnum(obj) {
  return !!obj && typeof obj === "function" && isPgEnumSym in obj && obj[isPgEnumSym] === true;
}
class Subquery {
  static [entityKind] = "Subquery";
  constructor(sql2, selection, alias, isWith = false) {
    this._ = {
      brand: "Subquery",
      sql: sql2,
      selectedFields: selection,
      alias,
      isWith
    };
  }
  // getSQL(): SQL<unknown> {
  // 	return new SQL([this]);
  // }
}
const tracer = {
  startActiveSpan(name, fn) {
    {
      return fn();
    }
  }
};
const ViewBaseConfig = Symbol.for("drizzle:ViewBaseConfig");
function isSQLWrapper(value) {
  return value !== null && value !== void 0 && typeof value.getSQL === "function";
}
function mergeQueries(queries) {
  const result = { sql: "", params: [] };
  for (const query of queries) {
    result.sql += query.sql;
    result.params.push(...query.params);
    if (query.typings?.length) {
      if (!result.typings) {
        result.typings = [];
      }
      result.typings.push(...query.typings);
    }
  }
  return result;
}
class StringChunk {
  static [entityKind] = "StringChunk";
  value;
  constructor(value) {
    this.value = Array.isArray(value) ? value : [value];
  }
  getSQL() {
    return new SQL([this]);
  }
}
class SQL {
  constructor(queryChunks) {
    this.queryChunks = queryChunks;
  }
  static [entityKind] = "SQL";
  /** @internal */
  decoder = noopDecoder;
  shouldInlineParams = false;
  append(query) {
    this.queryChunks.push(...query.queryChunks);
    return this;
  }
  toQuery(config2) {
    return tracer.startActiveSpan("drizzle.buildSQL", (span) => {
      const query = this.buildQueryFromSourceParams(this.queryChunks, config2);
      span?.setAttributes({
        "drizzle.query.text": query.sql,
        "drizzle.query.params": JSON.stringify(query.params)
      });
      return query;
    });
  }
  buildQueryFromSourceParams(chunks, _config) {
    const config2 = Object.assign({}, _config, {
      inlineParams: _config.inlineParams || this.shouldInlineParams,
      paramStartIndex: _config.paramStartIndex || { value: 0 }
    });
    const {
      escapeName,
      escapeParam,
      prepareTyping,
      inlineParams,
      paramStartIndex
    } = config2;
    return mergeQueries(chunks.map((chunk) => {
      if (is(chunk, StringChunk)) {
        return { sql: chunk.value.join(""), params: [] };
      }
      if (is(chunk, Name)) {
        return { sql: escapeName(chunk.value), params: [] };
      }
      if (chunk === void 0) {
        return { sql: "", params: [] };
      }
      if (Array.isArray(chunk)) {
        const result = [new StringChunk("(")];
        for (const [i, p] of chunk.entries()) {
          result.push(p);
          if (i < chunk.length - 1) {
            result.push(new StringChunk(", "));
          }
        }
        result.push(new StringChunk(")"));
        return this.buildQueryFromSourceParams(result, config2);
      }
      if (is(chunk, SQL)) {
        return this.buildQueryFromSourceParams(chunk.queryChunks, {
          ...config2,
          inlineParams: inlineParams || chunk.shouldInlineParams
        });
      }
      if (is(chunk, Table)) {
        const schemaName = chunk[Table.Symbol.Schema];
        const tableName = chunk[Table.Symbol.Name];
        return {
          sql: schemaName === void 0 ? escapeName(tableName) : escapeName(schemaName) + "." + escapeName(tableName),
          params: []
        };
      }
      if (is(chunk, Column)) {
        if (_config.invokeSource === "indexes") {
          return { sql: escapeName(chunk.name), params: [] };
        }
        return { sql: escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(chunk.name), params: [] };
      }
      if (is(chunk, View)) {
        const schemaName = chunk[ViewBaseConfig].schema;
        const viewName = chunk[ViewBaseConfig].name;
        return {
          sql: schemaName === void 0 ? escapeName(viewName) : escapeName(schemaName) + "." + escapeName(viewName),
          params: []
        };
      }
      if (is(chunk, Param)) {
        const mappedValue = chunk.value === null ? null : chunk.encoder.mapToDriverValue(chunk.value);
        if (is(mappedValue, SQL)) {
          return this.buildQueryFromSourceParams([mappedValue], config2);
        }
        if (inlineParams) {
          return { sql: this.mapInlineParam(mappedValue, config2), params: [] };
        }
        let typings = ["none"];
        if (prepareTyping) {
          typings = [prepareTyping(chunk.encoder)];
        }
        return { sql: escapeParam(paramStartIndex.value++, mappedValue), params: [mappedValue], typings };
      }
      if (is(chunk, Placeholder)) {
        return { sql: escapeParam(paramStartIndex.value++, chunk), params: [chunk], typings: ["none"] };
      }
      if (is(chunk, SQL.Aliased) && chunk.fieldAlias !== void 0) {
        return { sql: escapeName(chunk.fieldAlias), params: [] };
      }
      if (is(chunk, Subquery)) {
        if (chunk._.isWith) {
          return { sql: escapeName(chunk._.alias), params: [] };
        }
        return this.buildQueryFromSourceParams([
          new StringChunk("("),
          chunk._.sql,
          new StringChunk(") "),
          new Name(chunk._.alias)
        ], config2);
      }
      if (isPgEnum(chunk)) {
        if (chunk.schema) {
          return { sql: escapeName(chunk.schema) + "." + escapeName(chunk.enumName), params: [] };
        }
        return { sql: escapeName(chunk.enumName), params: [] };
      }
      if (isSQLWrapper(chunk)) {
        if (chunk.shouldOmitSQLParens?.()) {
          return this.buildQueryFromSourceParams([chunk.getSQL()], config2);
        }
        return this.buildQueryFromSourceParams([
          new StringChunk("("),
          chunk.getSQL(),
          new StringChunk(")")
        ], config2);
      }
      if (inlineParams) {
        return { sql: this.mapInlineParam(chunk, config2), params: [] };
      }
      return { sql: escapeParam(paramStartIndex.value++, chunk), params: [chunk], typings: ["none"] };
    }));
  }
  mapInlineParam(chunk, { escapeString }) {
    if (chunk === null) {
      return "null";
    }
    if (typeof chunk === "number" || typeof chunk === "boolean") {
      return chunk.toString();
    }
    if (typeof chunk === "string") {
      return escapeString(chunk);
    }
    if (typeof chunk === "object") {
      const mappedValueAsString = chunk.toString();
      if (mappedValueAsString === "[object Object]") {
        return escapeString(JSON.stringify(chunk));
      }
      return escapeString(mappedValueAsString);
    }
    throw new Error("Unexpected param value: " + chunk);
  }
  getSQL() {
    return this;
  }
  as(alias) {
    if (alias === void 0) {
      return this;
    }
    return new SQL.Aliased(this, alias);
  }
  mapWith(decoder) {
    this.decoder = typeof decoder === "function" ? { mapFromDriverValue: decoder } : decoder;
    return this;
  }
  inlineParams() {
    this.shouldInlineParams = true;
    return this;
  }
  /**
   * This method is used to conditionally include a part of the query.
   *
   * @param condition - Condition to check
   * @returns itself if the condition is `true`, otherwise `undefined`
   */
  if(condition) {
    return condition ? this : void 0;
  }
}
class Name {
  constructor(value) {
    this.value = value;
  }
  static [entityKind] = "Name";
  brand;
  getSQL() {
    return new SQL([this]);
  }
}
const noopDecoder = {
  mapFromDriverValue: (value) => value
};
const noopEncoder = {
  mapToDriverValue: (value) => value
};
({
  ...noopDecoder,
  ...noopEncoder
});
class Param {
  /**
   * @param value - Parameter value
   * @param encoder - Encoder to convert the value to a driver parameter
   */
  constructor(value, encoder = noopEncoder) {
    this.value = value;
    this.encoder = encoder;
  }
  static [entityKind] = "Param";
  brand;
  getSQL() {
    return new SQL([this]);
  }
}
function sql(strings, ...params) {
  const queryChunks = [];
  if (params.length > 0 || strings.length > 0 && strings[0] !== "") {
    queryChunks.push(new StringChunk(strings[0]));
  }
  for (const [paramIndex, param2] of params.entries()) {
    queryChunks.push(param2, new StringChunk(strings[paramIndex + 1]));
  }
  return new SQL(queryChunks);
}
((sql2) => {
  function empty() {
    return new SQL([]);
  }
  sql2.empty = empty;
  function fromList(list) {
    return new SQL(list);
  }
  sql2.fromList = fromList;
  function raw2(str) {
    return new SQL([new StringChunk(str)]);
  }
  sql2.raw = raw2;
  function join(chunks, separator) {
    const result = [];
    for (const [i, chunk] of chunks.entries()) {
      if (i > 0 && separator !== void 0) {
        result.push(separator);
      }
      result.push(chunk);
    }
    return new SQL(result);
  }
  sql2.join = join;
  function identifier(value) {
    return new Name(value);
  }
  sql2.identifier = identifier;
  function placeholder2(name2) {
    return new Placeholder(name2);
  }
  sql2.placeholder = placeholder2;
  function param2(value, encoder) {
    return new Param(value, encoder);
  }
  sql2.param = param2;
})(sql || (sql = {}));
((SQL2) => {
  class Aliased {
    constructor(sql2, fieldAlias) {
      this.sql = sql2;
      this.fieldAlias = fieldAlias;
    }
    static [entityKind] = "SQL.Aliased";
    /** @internal */
    isSelectionField = false;
    getSQL() {
      return this.sql;
    }
    /** @internal */
    clone() {
      return new Aliased(this.sql, this.fieldAlias);
    }
  }
  SQL2.Aliased = Aliased;
})(SQL || (SQL = {}));
class Placeholder {
  constructor(name2) {
    this.name = name2;
  }
  static [entityKind] = "Placeholder";
  getSQL() {
    return new SQL([this]);
  }
}
class View {
  static [entityKind] = "View";
  /** @internal */
  [ViewBaseConfig];
  constructor({ name: name2, schema, selectedFields, query }) {
    this[ViewBaseConfig] = {
      name: name2,
      originalName: name2,
      schema,
      selectedFields,
      query,
      isExisting: !query,
      isAlias: false
    };
  }
  getSQL() {
    return new SQL([this]);
  }
}
Column.prototype.getSQL = function() {
  return new SQL([this]);
};
Table.prototype.getSQL = function() {
  return new SQL([this]);
};
Subquery.prototype.getSQL = function() {
  return new SQL([this]);
};
const TRANSFER_LIMITS = { file: 16 * 1024 * 1024, payload: 10 * 1024 * 1024, key: 1024 * 1024 };
const TRANSFER_CAPABILITIES = ["project-db-diagnostics", "remote-password-ssh", "smartdd-project-context"];
const ref = string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
strictObject({
  name: string().trim().min(1).max(100),
  directories: array(strictObject({ ref, mode: _enum(["local", "source"]), localPath: string().max(1024).optional() })).min(1).max(50),
  rulesPath: string().max(1024).nullable(),
  selectedProfileRefs: array(ref).max(50),
  executables: array(strictObject({ ref, executable: string().max(1024).nullable() })).max(50)
});
const InlineForeignKeys = Symbol.for("drizzle:SQLiteInlineForeignKeys");
class SQLiteTable extends Table {
  static [entityKind] = "SQLiteTable";
  /** @internal */
  static Symbol = Object.assign({}, Table.Symbol, {
    InlineForeignKeys
  });
  /** @internal */
  [Table.Symbol.Columns];
  /** @internal */
  [InlineForeignKeys] = [];
  /** @internal */
  [Table.Symbol.ExtraConfigBuilder] = void 0;
}
function sqliteTableBase(name, columns, extraConfig, schema, baseName = name) {
  const rawTable = new SQLiteTable(name, schema, baseName);
  const builtColumns = Object.fromEntries(
    Object.entries(columns).map(([name2, colBuilderBase]) => {
      const colBuilder = colBuilderBase;
      const column = colBuilder.build(rawTable);
      rawTable[InlineForeignKeys].push(...colBuilder.buildForeignKeys(column, rawTable));
      return [name2, column];
    })
  );
  const table = Object.assign(rawTable, builtColumns);
  table[Table.Symbol.Columns] = builtColumns;
  table[Table.Symbol.ExtraConfigColumns] = builtColumns;
  if (extraConfig) {
    table[SQLiteTable.Symbol.ExtraConfigBuilder] = extraConfig;
  }
  return table;
}
const sqliteTable = (name, columns, extraConfig) => {
  return sqliteTableBase(name, columns, extraConfig);
};
class ForeignKeyBuilder {
  static [entityKind] = "SQLiteForeignKeyBuilder";
  /** @internal */
  reference;
  /** @internal */
  _onUpdate;
  /** @internal */
  _onDelete;
  constructor(config2, actions) {
    this.reference = () => {
      const { name, columns, foreignColumns } = config2();
      return { name, columns, foreignTable: foreignColumns[0].table, foreignColumns };
    };
    if (actions) {
      this._onUpdate = actions.onUpdate;
      this._onDelete = actions.onDelete;
    }
  }
  onUpdate(action) {
    this._onUpdate = action;
    return this;
  }
  onDelete(action) {
    this._onDelete = action;
    return this;
  }
  /** @internal */
  build(table) {
    return new ForeignKey(table, this);
  }
}
class ForeignKey {
  constructor(table, builder) {
    this.table = table;
    this.reference = builder.reference;
    this.onUpdate = builder._onUpdate;
    this.onDelete = builder._onDelete;
  }
  static [entityKind] = "SQLiteForeignKey";
  reference;
  onUpdate;
  onDelete;
  getName() {
    const { name, columns, foreignColumns } = this.reference();
    const columnNames = columns.map((column) => column.name);
    const foreignColumnNames = foreignColumns.map((column) => column.name);
    const chunks = [
      this.table[SQLiteTable.Symbol.Name],
      ...columnNames,
      foreignColumns[0].table[SQLiteTable.Symbol.Name],
      ...foreignColumnNames
    ];
    return name ?? `${chunks.join("_")}_fk`;
  }
}
function foreignKey(config2) {
  function mappedConfig() {
    if (typeof config2 === "function") {
      const { name, columns, foreignColumns } = config2();
      return {
        name,
        columns,
        foreignColumns
      };
    }
    return config2;
  }
  return new ForeignKeyBuilder(mappedConfig);
}
function uniqueKeyName(table, columns) {
  return `${table[SQLiteTable.Symbol.Name]}_${columns.join("_")}_unique`;
}
class SQLiteColumnBuilder extends ColumnBuilder {
  static [entityKind] = "SQLiteColumnBuilder";
  foreignKeyConfigs = [];
  references(ref2, actions = {}) {
    this.foreignKeyConfigs.push({ ref: ref2, actions });
    return this;
  }
  unique(name) {
    this.config.isUnique = true;
    this.config.uniqueName = name;
    return this;
  }
  generatedAlwaysAs(as, config2) {
    this.config.generated = {
      as,
      type: "always",
      mode: config2?.mode ?? "virtual"
    };
    return this;
  }
  /** @internal */
  buildForeignKeys(column, table) {
    return this.foreignKeyConfigs.map(({ ref: ref2, actions }) => {
      return ((ref22, actions2) => {
        const builder = new ForeignKeyBuilder(() => {
          const foreignColumn = ref22();
          return { columns: [column], foreignColumns: [foreignColumn] };
        });
        if (actions2.onUpdate) {
          builder.onUpdate(actions2.onUpdate);
        }
        if (actions2.onDelete) {
          builder.onDelete(actions2.onDelete);
        }
        return builder.build(table);
      })(ref2, actions);
    });
  }
}
class SQLiteColumn extends Column {
  constructor(table, config2) {
    if (!config2.uniqueName) {
      config2.uniqueName = uniqueKeyName(table, [config2.name]);
    }
    super(table, config2);
    this.table = table;
  }
  static [entityKind] = "SQLiteColumn";
}
class SQLiteBlobBufferBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteBlobBufferBuilder";
  constructor(name) {
    super(name, "buffer", "SQLiteBlobBuffer");
  }
  /** @internal */
  build(table) {
    return new SQLiteBlobBuffer(table, this.config);
  }
}
class SQLiteBlobBuffer extends SQLiteColumn {
  static [entityKind] = "SQLiteBlobBuffer";
  getSQLType() {
    return "blob";
  }
}
function blob(name, config2) {
  return new SQLiteBlobBufferBuilder(name);
}
class SQLiteBaseIntegerBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteBaseIntegerBuilder";
  constructor(name, dataType, columnType) {
    super(name, dataType, columnType);
    this.config.autoIncrement = false;
  }
  primaryKey(config2) {
    if (config2?.autoIncrement) {
      this.config.autoIncrement = true;
    }
    this.config.hasDefault = true;
    return super.primaryKey();
  }
}
class SQLiteBaseInteger extends SQLiteColumn {
  static [entityKind] = "SQLiteBaseInteger";
  autoIncrement = this.config.autoIncrement;
  getSQLType() {
    return "integer";
  }
}
class SQLiteIntegerBuilder extends SQLiteBaseIntegerBuilder {
  static [entityKind] = "SQLiteIntegerBuilder";
  constructor(name) {
    super(name, "number", "SQLiteInteger");
  }
  build(table) {
    return new SQLiteInteger(
      table,
      this.config
    );
  }
}
class SQLiteInteger extends SQLiteBaseInteger {
  static [entityKind] = "SQLiteInteger";
}
class SQLiteTimestampBuilder extends SQLiteBaseIntegerBuilder {
  static [entityKind] = "SQLiteTimestampBuilder";
  constructor(name, mode) {
    super(name, "date", "SQLiteTimestamp");
    this.config.mode = mode;
  }
  /**
   * @deprecated Use `default()` with your own expression instead.
   *
   * Adds `DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))` to the column, which is the current epoch timestamp in milliseconds.
   */
  defaultNow() {
    return this.default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`);
  }
  build(table) {
    return new SQLiteTimestamp(
      table,
      this.config
    );
  }
}
class SQLiteTimestamp extends SQLiteBaseInteger {
  static [entityKind] = "SQLiteTimestamp";
  mode = this.config.mode;
  mapFromDriverValue(value) {
    if (this.config.mode === "timestamp") {
      return new Date(value * 1e3);
    }
    return new Date(value);
  }
  mapToDriverValue(value) {
    const unix = value.getTime();
    if (this.config.mode === "timestamp") {
      return Math.floor(unix / 1e3);
    }
    return unix;
  }
}
class SQLiteBooleanBuilder extends SQLiteBaseIntegerBuilder {
  static [entityKind] = "SQLiteBooleanBuilder";
  constructor(name, mode) {
    super(name, "boolean", "SQLiteBoolean");
    this.config.mode = mode;
  }
  build(table) {
    return new SQLiteBoolean(
      table,
      this.config
    );
  }
}
class SQLiteBoolean extends SQLiteBaseInteger {
  static [entityKind] = "SQLiteBoolean";
  mode = this.config.mode;
  mapFromDriverValue(value) {
    return Number(value) === 1;
  }
  mapToDriverValue(value) {
    return value ? 1 : 0;
  }
}
function integer(name, config2) {
  if (config2?.mode === "timestamp" || config2?.mode === "timestamp_ms") {
    return new SQLiteTimestampBuilder(name, config2.mode);
  }
  if (config2?.mode === "boolean") {
    return new SQLiteBooleanBuilder(name, config2.mode);
  }
  return new SQLiteIntegerBuilder(name);
}
class SQLiteTextBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteTextBuilder";
  constructor(name, config2) {
    super(name, "string", "SQLiteText");
    this.config.enumValues = config2.enum;
    this.config.length = config2.length;
  }
  /** @internal */
  build(table) {
    return new SQLiteText(table, this.config);
  }
}
class SQLiteText extends SQLiteColumn {
  static [entityKind] = "SQLiteText";
  enumValues = this.config.enumValues;
  length = this.config.length;
  constructor(table, config2) {
    super(table, config2);
  }
  getSQLType() {
    return `text${this.config.length ? `(${this.config.length})` : ""}`;
  }
}
class SQLiteTextJsonBuilder extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteTextJsonBuilder";
  constructor(name) {
    super(name, "json", "SQLiteTextJson");
  }
  /** @internal */
  build(table) {
    return new SQLiteTextJson(
      table,
      this.config
    );
  }
}
class SQLiteTextJson extends SQLiteColumn {
  static [entityKind] = "SQLiteTextJson";
  getSQLType() {
    return "text";
  }
  mapFromDriverValue(value) {
    return JSON.parse(value);
  }
  mapToDriverValue(value) {
    return JSON.stringify(value);
  }
}
function text$1(name, config2 = {}) {
  return config2.mode === "json" ? new SQLiteTextJsonBuilder(name) : new SQLiteTextBuilder(name, config2);
}
class IndexBuilderOn {
  constructor(name, unique) {
    this.name = name;
    this.unique = unique;
  }
  static [entityKind] = "SQLiteIndexBuilderOn";
  on(...columns) {
    return new IndexBuilder(this.name, columns, this.unique);
  }
}
class IndexBuilder {
  static [entityKind] = "SQLiteIndexBuilder";
  /** @internal */
  config;
  constructor(name, columns, unique) {
    this.config = {
      name,
      columns,
      unique,
      where: void 0
    };
  }
  /**
   * Condition for partial index.
   */
  where(condition) {
    this.config.where = condition;
    return this;
  }
  /** @internal */
  build(table) {
    return new Index(this.config, table);
  }
}
class Index {
  static [entityKind] = "SQLiteIndex";
  config;
  constructor(config2, table) {
    this.config = { ...config2, table };
  }
}
function index(name) {
  return new IndexBuilderOn(name, false);
}
function uniqueIndex(name) {
  return new IndexBuilderOn(name, true);
}
function primaryKey(...config2) {
  if (config2[0].columns) {
    return new PrimaryKeyBuilder(config2[0].columns, config2[0].name);
  }
  return new PrimaryKeyBuilder(config2);
}
class PrimaryKeyBuilder {
  static [entityKind] = "SQLitePrimaryKeyBuilder";
  /** @internal */
  columns;
  /** @internal */
  name;
  constructor(columns, name) {
    this.columns = columns;
    this.name = name;
  }
  /** @internal */
  build(table) {
    return new PrimaryKey(table, this.columns, this.name);
  }
}
class PrimaryKey {
  constructor(table, columns, name) {
    this.table = table;
    this.columns = columns;
    this.name = name;
  }
  static [entityKind] = "SQLitePrimaryKey";
  columns;
  name;
  getName() {
    return this.name ?? `${this.table[SQLiteTable.Symbol.Name]}_${this.columns.map((column) => column.name).join("_")}_pk`;
  }
}
sqliteTable("sessions", {
  id: text$1("id").primaryKey(),
  runner: text$1("runner").notNull(),
  cwd: text$1("cwd").notNull(),
  nativeSessionId: text$1("native_session_id"),
  title: text$1("title").notNull(),
  createdAt: integer("created_at").notNull()
});
sqliteTable("app_secrets", {
  key: text$1("key").primaryKey(),
  secret: text$1("secret").notNull()
});
sqliteTable("app_settings", {
  key: text$1("key").primaryKey(),
  value: text$1("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`)
});
const timestamps = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
};
const lastTest = {
  lastTestAt: integer("last_test_at"),
  lastTestOk: integer("last_test_ok", { mode: "boolean" }),
  lastTestCategory: text$1("last_test_category"),
  lastTestMessage: text$1("last_test_message"),
  lastTestMs: integer("last_test_ms")
};
const projects = sqliteTable("projects", {
  id: text$1("id").primaryKey(),
  name: text$1("name").notNull(),
  /** JSON string[]: names used to match natural language ("AIS"). */
  aliases: text$1("aliases").notNull().default("[]"),
  description: text$1("description").notNull().default(""),
  rulesPath: text$1("rules_path"),
  /** Bumped on every change to the project or its resources; sessions record the version they started with. */
  configVersion: integer("config_version").notNull().default(1),
  archivedAt: integer("archived_at"),
  ...timestamps
});
const projectDirs = sqliteTable(
  "project_dirs",
  {
    id: text$1("id").primaryKey(),
    projectId: text$1("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    label: text$1("label").notNull().default(""),
    path: text$1("path").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    ...timestamps
  },
  (t) => ({ byProject: index("project_dirs_project_idx").on(t.projectId) })
);
sqliteTable(
  "project_databases",
  {
    id: text$1("id").primaryKey(),
    projectId: text$1("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    /** dev / test / prod, or a custom label. */
    env: text$1("env").notNull(),
    label: text$1("label").notNull().default(""),
    aliases: text$1("aliases").notNull().default("[]"),
    vendor: text$1("vendor").notNull(),
    host: text$1("host").notNull(),
    port: integer("port").notNull(),
    database: text$1("database").notNull().default(""),
    schema: text$1("schema"),
    username: text$1("username").notNull().default(""),
    accessLevel: text$1("access_level", { enum: ["readonly", "readwrite"] }).notNull().default("readonly"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    note: text$1("note").notNull().default(""),
    ...lastTest,
    ...timestamps
  },
  (t) => ({ byProject: index("project_databases_project_idx").on(t.projectId) })
);
sqliteTable(
  "project_servers",
  {
    id: text$1("id").primaryKey(),
    projectId: text$1("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    env: text$1("env").notNull(),
    label: text$1("label").notNull().default(""),
    aliases: text$1("aliases").notNull().default("[]"),
    host: text$1("host").notNull(),
    port: integer("port").notNull().default(22),
    username: text$1("username").notNull(),
    authType: text$1("auth_type", { enum: ["password", "key"] }).notNull(),
    privateKeyPath: text$1("private_key_path"),
    /** Mirrors remote-password-ssh: log in, then `sudo -i`. */
    defaultRoot: integer("default_root", { mode: "boolean" }).notNull().default(false),
    /** none: no sudo; same-as-login: reuse the login password; separate: its own secret. */
    sudoPolicy: text$1("sudo_policy", { enum: ["none", "same-as-login", "separate"] }).notNull().default("none"),
    appRoot: text$1("app_root"),
    logsPath: text$1("logs_path"),
    note: text$1("note").notNull().default(""),
    ...lastTest,
    ...timestamps
  },
  (t) => ({ byProject: index("project_servers_project_idx").on(t.projectId) })
);
const aiProfiles = sqliteTable("ai_profiles", {
  id: text$1("id").primaryKey(),
  name: text$1("name").notNull(),
  runner: text$1("runner").notNull(),
  /** null: the runner's own command on the login shell's PATH. */
  executable: text$1("executable"),
  /** JSON [{ name, secret, value }]; value is null for secret variables. */
  env: text$1("env").notNull().default("[]"),
  /** JSON string[] passed before SmartDD's own arguments. */
  args: text$1("args").notNull().default("[]"),
  color: text$1("color"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  /** Imported command unavailable on this computer; a manual configuration/test releases it. */
  commandPending: integer("command_pending", { mode: "boolean" }).notNull().default(false),
  /** Last health result: a test, or an API answer seen in a task (the latest wins). */
  checkStatus: text$1("check_status", { enum: ["ok", "failed", "warning"] }),
  checkCategory: text$1("check_category"),
  /** manual / auto / task:<taskId> */
  checkSource: text$1("check_source"),
  checkMessage: text$1("check_message"),
  checkMs: integer("check_ms"),
  checkAt: integer("check_at"),
  ...timestamps
});
sqliteTable(
  "tasks",
  {
    id: text$1("id").primaryKey(),
    projectId: text$1("project_id").references(() => projects.id, { onDelete: "cascade" }),
    dirId: text$1("dir_id").references(() => projectDirs.id, { onDelete: "set null" }),
    cwd: text$1("cwd").notNull(),
    aiProfileId: text$1("ai_profile_id").references(() => aiProfiles.id, { onDelete: "set null" }),
    aiProfileName: text$1("ai_profile_name"),
    runner: text$1("runner").notNull(),
    nativeSessionId: text$1("native_session_id"),
    title: text$1("title").notNull(),
    firstMessage: text$1("first_message").notNull().default(""),
    /** JSON string[] of variable names given to the CLI on the last launch (no values). */
    injectedEnvNames: text$1("injected_env_names").notNull().default("[]"),
    configVersion: integer("config_version"),
    /** CLAUDE_CONFIG_DIR / CODEX_HOME in effect, so resume looks for the session file in the right place. */
    stateRoot: text$1("state_root"),
    /** NULL: unknown or running without evidence; false: owned exit without history; true: history observed. */
    nativeHistoryObserved: integer("native_history_observed", { mode: "boolean" }),
    /** M4: version pins, hashes and injection self-check, never secret values. */
    runtimeSnapshot: text$1("runtime_snapshot"),
    archivedAt: integer("archived_at"),
    lastLaunchedAt: integer("last_launched_at"),
    ...timestamps
  },
  (t) => ({ byProject: index("tasks_project_idx").on(t.projectId) })
);
sqliteTable("skill_versions", {
  id: text$1("id").primaryKey(),
  skillId: text$1("skill_id").notNull(),
  name: text$1("name").notNull(),
  version: text$1("version").notNull(),
  hash: text$1("hash").notNull(),
  installedAt: integer("installed_at").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(false)
});
sqliteTable("project_capabilities", {
  id: text$1("id").primaryKey(),
  projectId: text$1("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  capabilityId: text$1("capability_id").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true)
});
sqliteTable("project_import_receipts", {
  requestId: text$1("request_id").primaryKey(),
  fingerprint: text$1("fingerprint").notNull(),
  result: text$1("result").notNull(),
  createdAt: integer("created_at").notNull()
});
sqliteTable("imported_keys", {
  serverId: text$1("server_id").primaryKey(),
  path: text$1("path").notNull(),
  createdAt: integer("created_at").notNull()
});
const capabilityResources = sqliteTable("capability_resources", {
  resourceId: text$1("resource_id").primaryKey(),
  kind: text$1("kind").notNull(),
  contentHash: text$1("content_hash").notNull(),
  ownerStoreId: text$1("owner_store_id").notNull(),
  pathScope: text$1("path_scope", { enum: ["C", "H"] }).notNull(),
  relativePath: text$1("relative_path").notNull(),
  scopeIdentity: text$1("scope_identity").notNull().default(""),
  scopeRelativePath: text$1("scope_relative_path"),
  state: text$1("state", { enum: ["staged", "verified", "ready", "deleting", "removed", "recovery-required"] }).notNull(),
  generation: integer("generation").notNull().default(1),
  integrity: text$1("integrity", { enum: ["unknown", "valid", "invalid"] }).notNull(),
  operationId: text$1("operation_id")
}, (t) => ({ ownedPath: uniqueIndex("capability_resources_owned_path").on(t.ownerStoreId, t.pathScope, t.relativePath), discoveryPath: uniqueIndex("capability_resources_discovery_path").on(t.scopeIdentity, t.scopeRelativePath).where(sql`${t.pathScope}='H' AND ${t.state}<>'removed'`) }));
sqliteTable("capability_resource_dependencies", {
  resourceId: text$1("resource_id").notNull().references(() => capabilityResources.resourceId),
  dependencyId: text$1("dependency_id").notNull().references(() => capabilityResources.resourceId)
}, (t) => ({ pk: primaryKey({ columns: [t.resourceId, t.dependencyId] }) }));
const capabilityResourceLeases = sqliteTable("capability_resource_leases", {
  leaseId: text$1("lease_id").primaryKey(),
  resourceId: text$1("resource_id").notNull().references(() => capabilityResources.resourceId),
  ownerKind: text$1("owner_kind").notNull(),
  ownerId: text$1("owner_id").notNull(),
  hostInstanceId: text$1("host_instance_id").notNull(),
  pid: integer("pid"),
  processStartedAt: text$1("process_started_at"),
  state: text$1("state").notNull(),
  createdAt: text$1("created_at").notNull(),
  endedAt: text$1("ended_at")
}, (t) => ({ byResource: index("capability_resource_leases_resource_idx").on(t.resourceId, t.state) }));
const capabilityResourceOperations = sqliteTable("capability_resource_operations", {
  operationId: text$1("operation_id").primaryKey(),
  kind: text$1("kind").notNull(),
  ownerStoreId: text$1("owner_store_id").notNull(),
  state: text$1("state").notNull(),
  planJson: text$1("plan_json").notNull(),
  errorCode: text$1("error_code"),
  createdAt: text$1("created_at").notNull(),
  updatedAt: text$1("updated_at").notNull()
});
const capabilityPackages = sqliteTable("capability_packages", {
  packageHash: text$1("package_hash").primaryKey(),
  appId: text$1("app_id").notNull(),
  version: text$1("version").notNull(),
  hashAlgorithm: text$1("hash_algorithm").notNull(),
  relativePath: text$1("relative_path").notNull(),
  manifestJson: text$1("manifest_json").notNull(),
  resourceId: text$1("resource_id").notNull().references(() => capabilityResources.resourceId),
  installedAt: text$1("installed_at").notNull()
}, (t) => ({ identity: uniqueIndex("capability_packages_identity").on(t.appId, t.version) }));
sqliteTable("capability_active_packages", {
  appId: text$1("app_id").primaryKey(),
  packageHash: text$1("package_hash").notNull().references(() => capabilityPackages.packageHash),
  activationGeneration: integer("activation_generation").notNull(),
  activatedAt: text$1("activated_at").notNull()
});
sqliteTable("capability_install_journal", {
  installId: text$1("install_id").primaryKey().references(() => capabilityResourceOperations.operationId),
  hostBuild: text$1("host_build").notNull(),
  fromGeneration: integer("from_generation"),
  toGeneration: integer("to_generation"),
  state: text$1("state").notNull(),
  planJson: text$1("plan_json").notNull(),
  backupPath: text$1("backup_path"),
  errorCode: text$1("error_code"),
  updatedAt: text$1("updated_at").notNull()
});
const capabilitySessionSnapshots = sqliteTable("capability_session_snapshots", {
  taskId: text$1("task_id").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  snapshotJson: text$1("snapshot_json").notNull(),
  snapshotHash: text$1("snapshot_hash").notNull(),
  createdAt: text$1("created_at").notNull(),
  legacyStatus: text$1("legacy_status").notNull(),
  retentionState: text$1("retention_state", { enum: ["active", "tombstone", "hold"] }).notNull()
});
sqliteTable("capability_session_refs", {
  taskId: text$1("task_id").notNull().references(() => capabilitySessionSnapshots.taskId),
  refKind: text$1("ref_kind").notNull(),
  refId: text$1("ref_id").notNull().references(() => capabilityResources.resourceId),
  refHash: text$1("ref_hash").notNull(),
  relativePath: text$1("relative_path").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.taskId, t.refKind, t.refId] }), byResource: index("capability_session_refs_resource_idx").on(t.refId) }));
const capabilityRuns = sqliteTable("capability_runs", {
  runId: text$1("run_id").primaryKey(),
  taskId: text$1("task_id").notNull().references(() => capabilitySessionSnapshots.taskId),
  projectId: text$1("project_id").notNull(),
  runner: text$1("runner").notNull(),
  pid: integer("pid"),
  processStartedAt: text$1("process_started_at"),
  state: text$1("state").notNull(),
  startedAt: text$1("started_at").notNull(),
  endedAt: text$1("ended_at"),
  errorCode: text$1("error_code"),
  snapshotHash: text$1("snapshot_hash"),
  ownerInstanceId: text$1("owner_instance_id"),
  ownerPid: integer("owner_pid"),
  ownerStartedAt: text$1("owner_started_at"),
  bindingsJson: text$1("bindings_json").notNull().default("[]"),
  ptyId: text$1("pty_id"),
  revocationState: text$1("revocation_state").notNull().default("open")
});
sqliteTable("capability_schema_migrations", {
  appId: text$1("app_id").notNull(),
  migrationId: text$1("migration_id").notNull(),
  checksum: text$1("checksum").notNull(),
  fromVersion: integer("from_version").notNull(),
  toVersion: integer("to_version").notNull(),
  appliedAt: text$1("applied_at").notNull(),
  hostBuild: text$1("host_build").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.appId, t.migrationId] }) }));
const applicationConnections = sqliteTable("application_connections", {
  id: text$1("id").primaryKey(),
  appId: text$1("app_id").notNull(),
  providerId: text$1("provider_id").notNull(),
  name: text$1("name").notNull(),
  configSchemaVersion: integer("config_schema_version").notNull().default(1),
  configJson: text$1("config_json").notNull(),
  revision: integer("revision").notNull(),
  configRevision: integer("config_revision").notNull(),
  identityRevision: integer("identity_revision").notNull(),
  verifiedIdentityJson: text$1("verified_identity_json").notNull(),
  identityHash: text$1("identity_hash").notNull(),
  secretRef: text$1("secret_ref"),
  secretRevision: integer("secret_revision").notNull(),
  policyRevision: integer("policy_revision").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  authState: text$1("auth_state").notNull(),
  health: text$1("health").notNull(),
  healthCode: text$1("health_code"),
  healthMessage: text$1("health_message"),
  testedAt: text$1("tested_at"),
  cleanupPending: integer("cleanup_pending", { mode: "boolean" }).notNull().default(false),
  createdAt: text$1("created_at").notNull(),
  updatedAt: text$1("updated_at").notNull()
}, (t) => ({ byProvider: index("application_connections_provider_idx").on(t.providerId, t.appId), identityKey: uniqueIndex("application_connections_identity_key").on(t.id, t.providerId, t.appId) }));
sqliteTable("application_secret_changes", {
  operationId: text$1("operation_id").primaryKey(),
  connectionId: text$1("connection_id").notNull(),
  expectedRevision: integer("expected_revision").notNull(),
  oldSecretRef: text$1("old_secret_ref"),
  newSecretRef: text$1("new_secret_ref"),
  candidateHash: text$1("candidate_hash").notNull(),
  candidateJson: text$1("candidate_json").notNull(),
  verifiedIdentityJson: text$1("verified_identity_json"),
  compatibilityPlanJson: text$1("compatibility_plan_json"),
  expiresAt: text$1("expires_at").notNull(),
  state: text$1("state").notNull(),
  errorCode: text$1("error_code"),
  createdAt: text$1("created_at").notNull(),
  updatedAt: text$1("updated_at").notNull()
});
sqliteTable("application_catalog_state", {
  appId: text$1("app_id").primaryKey(),
  added: integer("added", { mode: "boolean" }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  revision: integer("revision").notNull(),
  updatedAt: text$1("updated_at").notNull()
});
const applicationProjectSettings = sqliteTable("application_project_settings", {
  projectId: text$1("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  appId: text$1("app_id").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  bindingRevision: integer("binding_revision").notNull(),
  policyRevision: integer("policy_revision").notNull().default(0),
  pendingOperationId: text$1("pending_operation_id"),
  updatedAt: text$1("updated_at").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.projectId, t.appId] }) }));
sqliteTable("application_project_bindings", {
  projectId: text$1("project_id").notNull(),
  appId: text$1("app_id").notNull(),
  slot: text$1("slot").notNull(),
  connectionId: text$1("connection_id").notNull(),
  identityRevision: integer("identity_revision").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.projectId, t.appId, t.slot] }), connectionRole: foreignKey({ columns: [t.connectionId, t.slot, t.appId], foreignColumns: [applicationConnections.id, applicationConnections.providerId, applicationConnections.appId] }), projectScope: foreignKey({ columns: [t.projectId, t.appId], foreignColumns: [applicationProjectSettings.projectId, applicationProjectSettings.appId] }).onDelete("cascade") }));
sqliteTable("application_binding_changes", {
  operationId: text$1("operation_id").primaryKey(),
  projectId: text$1("project_id").notNull(),
  appId: text$1("app_id").notNull(),
  fromRevision: integer("from_revision").notNull(),
  toRevision: integer("to_revision"),
  previousJson: text$1("previous_json").notNull(),
  nextJson: text$1("next_json").notNull(),
  state: text$1("state").notNull(),
  errorCode: text$1("error_code"),
  createdAt: text$1("created_at").notNull(),
  updatedAt: text$1("updated_at").notNull()
});
const mailBlobObjects = sqliteTable("mail_blob_objects", {
  contentHash: text$1("content_hash").primaryKey(),
  byteSize: integer("byte_size").notNull(),
  createdAt: text$1("created_at").notNull()
});
const mailAttachmentObjects = sqliteTable("mail_attachment_objects", {
  id: text$1("id").primaryKey(),
  projectId: text$1("project_id").notNull(),
  contentHash: text$1("content_hash").notNull().references(() => mailBlobObjects.contentHash),
  filename: text$1("filename").notNull(),
  contentType: text$1("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  kind: text$1("kind", { enum: ["attachment", "message"] }).notNull().default("attachment"),
  createdAt: text$1("created_at").notNull()
});
sqliteTable("mail_blob_writes", {
  operationId: text$1("operation_id").primaryKey(),
  attachmentId: text$1("attachment_id").notNull(),
  projectId: text$1("project_id").notNull(),
  requestHash: text$1("request_hash").notNull(),
  metadataJson: text$1("metadata_json").notNull(),
  state: text$1("state").notNull(),
  errorCode: text$1("error_code"),
  cleanupPending: integer("cleanup_pending", { mode: "boolean" }).notNull().default(false),
  createdAt: text$1("created_at").notNull(),
  updatedAt: text$1("updated_at").notNull()
});
const mailDrafts = sqliteTable("mail_drafts", {
  id: text$1("id").primaryKey(),
  projectId: text$1("project_id").notNull(),
  sourceTaskId: text$1("source_task_id"),
  copiedFromDraftId: text$1("copied_from_draft_id"),
  subject: text$1("subject").notNull(),
  attachmentCount: integer("attachment_count").notNull(),
  currentRevision: integer("current_revision").notNull(),
  state: text$1("state").notNull(),
  activeIntentId: text$1("active_intent_id"),
  lastExecutionId: text$1("last_execution_id"),
  createdAt: text$1("created_at").notNull(),
  updatedAt: text$1("updated_at").notNull()
}, (t) => ({ byProject: index("mail_drafts_project_updated").on(t.projectId, t.updatedAt, t.id), sourceDraft: foreignKey({ columns: [t.copiedFromDraftId], foreignColumns: [t.id] }) }));
const mailDraftRevisions = sqliteTable("mail_draft_revisions", {
  draftId: text$1("draft_id").notNull().references(() => mailDrafts.id),
  revision: integer("revision").notNull(),
  contentJson: text$1("content_json").notNull(),
  contentHash: text$1("content_hash").notNull(),
  actorTaskId: text$1("actor_task_id"),
  createdAt: text$1("created_at").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.draftId, t.revision] }) }));
sqliteTable("mail_draft_mutations", {
  projectId: text$1("project_id").notNull(),
  operationId: text$1("operation_id").notNull(),
  requestHash: text$1("request_hash").notNull(),
  draftId: text$1("draft_id").notNull().references(() => mailDrafts.id),
  resultJson: text$1("result_json").notNull(),
  createdAt: text$1("created_at").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.projectId, t.operationId] }) }));
const mailSendIntents = sqliteTable("mail_send_intents", {
  id: text$1("id").primaryKey(),
  projectId: text$1("project_id").notNull(),
  sourceTaskId: text$1("source_task_id"),
  sourceRunId: text$1("source_run_id"),
  operationId: text$1("operation_id").notNull(),
  requestHash: text$1("request_hash").notNull(),
  draftId: text$1("draft_id").notNull(),
  draftRevision: integer("draft_revision").notNull(),
  draftContentHash: text$1("draft_content_hash").notNull(),
  connectionId: text$1("connection_id").notNull().references(() => applicationConnections.id),
  identityRevision: integer("identity_revision").notNull(),
  configRevision: integer("config_revision").notNull(),
  policyRevision: integer("policy_revision").notNull(),
  bindingRevision: integer("binding_revision").notNull(),
  senderIdentityHash: text$1("sender_identity_hash"),
  identityJson: text$1("identity_json").notNull(),
  smtpConfigJson: text$1("smtp_config_json").notNull(),
  rawWriteId: text$1("raw_write_id").notNull(),
  rawObjectId: text$1("raw_object_id").references(() => mailAttachmentObjects.id),
  rawHash: text$1("raw_hash"),
  frozenHash: text$1("frozen_hash"),
  envelopeJson: text$1("envelope_json"),
  messageId: text$1("message_id").notNull(),
  reviewJson: text$1("review_json"),
  reviewHash: text$1("review_hash"),
  state: text$1("state").notNull(),
  grantId: text$1("grant_id"),
  executionId: text$1("execution_id"),
  cancelRequestedAt: text$1("cancel_requested_at"),
  ownerInstanceId: text$1("owner_instance_id").notNull(),
  ownerPid: integer("owner_pid").notNull(),
  ownerStartedAt: text$1("owner_started_at").notNull(),
  errorCode: text$1("error_code"),
  createdAt: text$1("created_at").notNull(),
  updatedAt: text$1("updated_at").notNull()
}, (t) => ({ operation: uniqueIndex("mail_send_intents_operation").on(t.projectId, t.operationId), byProject: index("mail_send_intents_project_updated").on(t.projectId, t.updatedAt, t.id), activity: index("mail_send_intents_activity_time").on(t.createdAt, t.id), revision: foreignKey({ columns: [t.draftId, t.draftRevision], foreignColumns: [mailDraftRevisions.draftId, mailDraftRevisions.revision] }) }));
sqliteTable("mail_send_grants", {
  id: text$1("id").primaryKey(),
  intentId: text$1("intent_id").notNull().references(() => mailSendIntents.id),
  source: text$1("source").notNull(),
  evidenceId: text$1("evidence_id").notNull(),
  evidenceHash: text$1("evidence_hash").notNull(),
  reviewHash: text$1("review_hash").notNull(),
  evidenceJson: text$1("evidence_json").notNull(),
  state: text$1("state").notNull(),
  expiresAt: text$1("expires_at").notNull(),
  createdAt: text$1("created_at").notNull()
}, (t) => ({ sourceEvent: uniqueIndex("mail_send_grants_source_event").on(t.source, t.evidenceId) }));
sqliteTable("mail_send_executions", {
  id: text$1("id").primaryKey(),
  intentId: text$1("intent_id").notNull().references(() => mailSendIntents.id),
  projectId: text$1("project_id").notNull(),
  draftId: text$1("draft_id").notNull(),
  draftRevision: integer("draft_revision").notNull(),
  reviewHash: text$1("review_hash").notNull(),
  state: text$1("state").notNull(),
  resultJson: text$1("result_json"),
  secretRevision: integer("secret_revision").notNull(),
  ownerInstanceId: text$1("owner_instance_id").notNull(),
  startedAt: text$1("started_at").notNull(),
  endedAt: text$1("ended_at")
}, (t) => ({ oncePerIntent: uniqueIndex("mail_send_executions_intent").on(t.intentId), oncePerRevision: uniqueIndex("mail_send_executions_draft_revision").on(t.draftId, t.draftRevision) }));
sqliteTable("application_binding_slot_revisions", {
  projectId: text$1("project_id").notNull(),
  appId: text$1("app_id").notNull(),
  slot: text$1("slot").notNull(),
  revision: integer("revision").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.projectId, t.appId, t.slot] }), projectScope: foreignKey({ columns: [t.projectId, t.appId], foreignColumns: [applicationProjectSettings.projectId, applicationProjectSettings.appId] }).onDelete("cascade") }));
sqliteTable("capability_session_identities", {
  taskId: text$1("task_id").primaryKey().references(() => capabilitySessionSnapshots.taskId),
  runner: text$1("runner").notNull(),
  identityRoot: text$1("identity_root").notNull(),
  sessionId: text$1("session_id"),
  cwd: text$1("cwd").notNull(),
  discoveryHome: text$1("discovery_home").notNull(),
  selectionHash: text$1("selection_hash").notNull(),
  createdAt: text$1("created_at").notNull(),
  updatedAt: text$1("updated_at").notNull()
}, (t) => ({ nativeIdentity: uniqueIndex("capability_session_native_identity").on(t.runner, t.identityRoot, t.sessionId) }));
sqliteTable("capability_session_mcp_names", {
  serverName: text$1("server_name").primaryKey(),
  taskId: text$1("task_id").notNull().references(() => capabilitySessionSnapshots.taskId),
  kind: text$1("kind").notNull()
}, (t) => ({ taskKind: uniqueIndex("capability_session_mcp_task_kind").on(t.taskId, t.kind) }));
sqliteTable("capability_snapshot_versions", {
  snapshotHash: text$1("snapshot_hash").primaryKey(),
  taskId: text$1("task_id").notNull().references(() => capabilitySessionSnapshots.taskId),
  snapshotJson: text$1("snapshot_json").notNull(),
  selectionHash: text$1("selection_hash").notNull(),
  createdAt: text$1("created_at").notNull()
});
sqliteTable("capability_session_holds", {
  taskId: text$1("task_id").primaryKey().references(() => capabilitySessionSnapshots.taskId),
  previousRetention: text$1("previous_retention").notNull(),
  reason: text$1("reason").notNull(),
  createdAt: text$1("created_at").notNull()
});
sqliteTable("capability_lease_resources", {
  leaseId: text$1("lease_id").notNull().references(() => capabilityResourceLeases.leaseId),
  resourceId: text$1("resource_id").notNull().references(() => capabilityResources.resourceId),
  contentHash: text$1("content_hash").notNull(),
  generation: integer("generation").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.leaseId, t.resourceId] }) }));
const capabilityRunProcesses = sqliteTable("capability_run_processes", {
  processId: text$1("process_id").primaryKey(),
  runId: text$1("run_id").notNull().references(() => capabilityRuns.runId),
  kind: text$1("kind").notNull(),
  launchKey: text$1("launch_key").notNull().unique(),
  state: text$1("state").notNull(),
  pid: integer("pid"),
  processStartedAt: text$1("process_started_at"),
  armedAt: text$1("armed_at"),
  attachedAt: text$1("attached_at"),
  endedAt: text$1("ended_at")
}, (t) => ({ byRun: index("capability_run_processes_run_idx").on(t.runId), oneCli: uniqueIndex("capability_run_one_cli_idx").on(t.runId).where(sql`${t.kind} = 'cli'`) }));
sqliteTable("capability_run_activities", {
  activityId: text$1("activity_id").primaryKey(),
  runId: text$1("run_id").notNull().references(() => capabilityRuns.runId),
  state: text$1("state").notNull(),
  startedAt: text$1("started_at").notNull(),
  endedAt: text$1("ended_at")
});
sqliteTable("capability_store_state", {
  singleton: integer("singleton").primaryKey(),
  storeId: text$1("store_id").notNull(),
  resourceGeneration: integer("resource_generation").notNull().default(1),
  maintenanceState: text$1("maintenance_state").notNull(),
  maintenanceOperationId: text$1("maintenance_operation_id")
});
sqliteTable("application_invocations", {
  operationId: text$1("operation_id").primaryKey(),
  runId: text$1("run_id").notNull().references(() => capabilityRuns.runId),
  requestId: text$1("request_id").notNull(),
  requestHash: text$1("request_hash").notNull(),
  projectId: text$1("project_id").notNull(),
  taskId: text$1("task_id").notNull(),
  appId: text$1("app_id").notNull(),
  packageHash: text$1("package_hash").notNull(),
  toolName: text$1("tool_name").notNull(),
  contractMajor: integer("contract_major").notNull(),
  connectionId: text$1("connection_id"),
  semantics: text$1("semantics").notNull(),
  state: text$1("state").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  errorCode: text$1("error_code"),
  effectState: text$1("effect_state").notNull(),
  startedAt: text$1("started_at").notNull(),
  endedAt: text$1("ended_at")
}, (t) => ({ request: uniqueIndex("application_invocations_run_request").on(t.runId, t.requestId), project: index("application_invocations_project_idx").on(t.projectId, t.startedAt), activity: index("application_invocations_activity_time").on(t.startedAt, t.operationId) }));
sqliteTable("capability_package_contracts", {
  packageHash: text$1("package_hash").notNull().references(() => capabilityPackages.packageHash),
  toolName: text$1("tool_name").notNull(),
  inputSource: text$1("input_source").notNull(),
  outputSource: text$1("output_source").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.packageHash, t.toolName] }) }));
sqliteTable("capability_agent_adapters", {
  agentId: text$1("agent_id").notNull(),
  version: text$1("version").notNull(),
  adapterHash: text$1("adapter_hash").notNull().unique(),
  resourceId: text$1("resource_id").notNull().references(() => capabilityResources.resourceId),
  manifestJson: text$1("manifest_json").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.agentId, t.version] }) }));
sqliteTable("capability_discovery_roots", { homeId: text$1("home_id").primaryKey(), canonicalHome: text$1("canonical_home").notNull().unique() });
sqliteTable("capability_builtin_package_sources", {
  packageHash: text$1("package_hash").notNull().references(() => capabilityPackages.packageHash),
  sourceIndexHash: text$1("source_index_hash").notNull(),
  sourceIndexJson: text$1("source_index_json").notNull(),
  approvedAt: text$1("approved_at").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.packageHash, t.sourceIndexHash] }) }));
const applicationDataOperations = sqliteTable("application_data_operations", {
  operationId: text$1("operation_id").primaryKey(),
  callerKind: text$1("caller_kind").notNull(),
  scopeKind: text$1("scope_kind").notNull(),
  projectId: text$1("project_id"),
  taskId: text$1("task_id"),
  runId: text$1("run_id"),
  jobId: text$1("job_id"),
  parentOperationId: text$1("parent_operation_id"),
  appId: text$1("app_id").notNull(),
  packageHash: text$1("package_hash").notNull(),
  dataApi: integer("data_api").notNull(),
  action: text$1("action").notNull(),
  semantics: text$1("semantics").notNull(),
  scopeHash: text$1("scope_hash").notNull(),
  targetsJson: text$1("targets_json").notNull().default("[]"),
  attemptCount: integer("attempt_count").notNull().default(1),
  state: text$1("state").notNull(),
  errorCode: text$1("error_code"),
  startedAt: text$1("started_at").notNull(),
  endedAt: text$1("ended_at")
}, (t) => ({ project: index("application_data_operations_project").on(t.projectId, t.startedAt), activity: index("application_data_operations_activity_time").on(t.startedAt, t.operationId) }));
sqliteTable("application_data_resources", {
  resourceId: text$1("resource_id").primaryKey(),
  projectId: text$1("project_id").notNull(),
  appId: text$1("app_id").notNull(),
  backingKind: text$1("backing_kind").notNull(),
  objectId: text$1("object_id").notNull(),
  objectRevision: text$1("object_revision").notNull(),
  part: text$1("part").notNull(),
  dataContractMajor: integer("data_contract_major").notNull(),
  permission: text$1("permission").notNull(),
  contentHash: text$1("content_hash").notNull(),
  byteSize: integer("byte_size").notNull(),
  mediaType: text$1("media_type").notNull(),
  mintedPackageHash: text$1("minted_package_hash").notNull(),
  mintedOperationId: text$1("minted_operation_id").notNull(),
  createdAt: text$1("created_at").notNull()
}, (t) => ({ businessIdentity: uniqueIndex("application_data_resources_identity").on(t.projectId, t.appId, t.backingKind, t.objectId, t.objectRevision, t.part, t.dataContractMajor) }));
const applicationZentaoRevisions = sqliteTable("application_zentao_revisions", {
  objectKey: text$1("object_key").primaryKey(),
  projectId: text$1("project_id").notNull(),
  connectionId: text$1("connection_id").notNull(),
  identityRevision: integer("identity_revision").notNull(),
  objectKind: text$1("object_kind").notNull(),
  nativeId: text$1("native_id").notNull(),
  contentRevision: text$1("content_revision").notNull(),
  representation: text$1("representation").notNull(),
  payloadJson: text$1("payload_json").notNull(),
  fetchedAt: text$1("fetched_at").notNull()
}, (t) => ({ identity: uniqueIndex("application_zentao_revisions_identity").on(t.projectId, t.connectionId, t.identityRevision, t.objectKind, t.nativeId, t.contentRevision, t.representation) }));
sqliteTable("application_zentao_files", {
  objectKey: text$1("object_key").notNull().references(() => applicationZentaoRevisions.objectKey),
  fileId: text$1("file_id").notNull(),
  contentHash: text$1("content_hash").notNull(),
  bytes: blob("bytes").notNull(),
  mediaType: text$1("media_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  fetchedAt: text$1("fetched_at").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.objectKey, t.fileId, t.contentHash] }) }));
sqliteTable("application_zentao_cursors", {
  cursorId: text$1("cursor_id").primaryKey(),
  projectId: text$1("project_id").notNull(),
  targetJson: text$1("target_json").notNull(),
  objectKind: text$1("object_kind").notNull(),
  pageSize: integer("page_size").notNull(),
  pageNo: integer("page_no").notNull(),
  expectedTotal: integer("expected_total").notNull(),
  seenJson: text$1("seen_json").notNull(),
  expiresAt: text$1("expires_at").notNull()
});
sqliteTable("application_zentao_operation_objects", {
  operationId: text$1("operation_id").notNull(),
  objectKey: text$1("object_key").notNull().references(() => applicationZentaoRevisions.objectKey)
}, (t) => ({ pk: primaryKey({ columns: [t.operationId, t.objectKey] }) }));
sqliteTable("application_read_receipt_checks", {
  checkOperationId: text$1("check_operation_id").primaryKey(),
  originalOperationId: text$1("original_operation_id").notNull(),
  checkedAt: text$1("checked_at").notNull()
});
sqliteTable("application_zentao_operation_resources", {
  operationId: text$1("operation_id").primaryKey(),
  backingJson: text$1("backing_json").notNull()
});
sqliteTable("application_index_waiters", {
  indexOperationId: text$1("index_operation_id").notNull().references(() => applicationDataOperations.operationId),
  parentOperationId: text$1("parent_operation_id").notNull().references(() => applicationDataOperations.operationId),
  sourceKey: text$1("source_key").notNull(),
  joinedAt: text$1("joined_at").notNull(),
  endedAt: text$1("ended_at"),
  state: text$1("state").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.indexOperationId, t.parentOperationId] }) }));
sqliteTable("application_mail_operation_sources", {
  operationId: text$1("operation_id").primaryKey().references(() => applicationDataOperations.operationId),
  sourceKey: text$1("source_key").notNull(),
  sourceRevision: text$1("source_revision").notNull(),
  operationKind: text$1("operation_kind").notNull(),
  provenanceJson: text$1("provenance_json").notNull(),
  createdAt: text$1("created_at").notNull()
});
sqliteTable("mail_user_action_sources", {
  evidenceId: text$1("evidence_id").primaryKey(),
  intentId: text$1("intent_id").notNull().references(() => mailSendIntents.id),
  sourceKind: text$1("source_kind").notNull(),
  sourceHash: text$1("source_hash").notNull(),
  provenanceJson: text$1("provenance_json").notNull(),
  createdAt: text$1("created_at").notNull()
});
sqliteTable("application_activity_subjects", {
  operationId: text$1("operation_id").notNull().references(() => applicationDataOperations.operationId, { onDelete: "cascade" }),
  kind: text$1("kind").notNull(),
  subjectId: text$1("subject_id").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.operationId, t.kind, t.subjectId] }), lookup: index("application_activity_subjects_lookup").on(t.kind, t.subjectId, t.operationId) }));
sqliteTable("capability_run_preparations", {
  runId: text$1("run_id").primaryKey().references(() => capabilityRuns.runId),
  evidenceJson: text$1("evidence_json").notNull(),
  evidenceHash: text$1("evidence_hash").notNull(),
  preparedAt: text$1("prepared_at").notNull()
}, (t) => ({ time: index("capability_run_evidence_time").on(t.preparedAt, t.runId) }));
sqliteTable("capability_bridge_observations", {
  runId: text$1("run_id").notNull().references(() => capabilityRuns.runId),
  bridgeId: text$1("bridge_id").notNull().references(() => capabilityRunProcesses.processId),
  evidenceJson: text$1("evidence_json").notNull(),
  evidenceHash: text$1("evidence_hash").notNull(),
  observedAt: text$1("observed_at").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.runId, t.bridgeId] }) }));
const capabilityLegacyMigrationPreparations = sqliteTable("capability_legacy_migration_preparations", {
  taskId: text$1("task_id").primaryKey().references(() => capabilitySessionSnapshots.taskId),
  sourceSnapshotJson: text$1("source_snapshot_json").notNull(),
  sourceRecordJson: text$1("source_record_json").notNull(),
  sourceSnapshotHash: text$1("source_snapshot_hash").notNull(),
  sourceIdentityJson: text$1("source_identity_json").notNull(),
  boundNativeSessionId: text$1("bound_native_session_id"),
  evidenceJson: text$1("evidence_json"),
  evidenceHash: text$1("evidence_hash"),
  manifestJson: text$1("manifest_json"),
  manifestHash: text$1("manifest_hash"),
  hBindingHash: text$1("h_binding_hash"),
  state: text$1("state", { enum: ["held", "prepared", "migrated"] }).notNull(),
  issueCode: text$1("issue_code"),
  createdAt: text$1("created_at").notNull(),
  updatedAt: text$1("updated_at").notNull()
}, (t) => ({ byState: index("capability_legacy_preparation_state").on(t.state, t.taskId) }));
sqliteTable("capability_legacy_h_bindings", {
  taskId: text$1("task_id").primaryKey().references(() => capabilityLegacyMigrationPreparations.taskId),
  bindingJson: text$1("binding_json").notNull(),
  bindingHash: text$1("binding_hash").notNull(),
  createdAt: text$1("created_at").notNull()
});
sqliteTable("capability_skill_observations", {
  runId: text$1("run_id").notNull().references(() => capabilityRuns.runId),
  appId: text$1("app_id").notNull(),
  skillId: text$1("skill_id").notNull(),
  kind: text$1("kind", { enum: ["discovery", "read"] }).notNull(),
  evidenceJson: text$1("evidence_json").notNull(),
  evidenceHash: text$1("evidence_hash").notNull(),
  observedAt: text$1("observed_at").notNull()
}, (t) => ({ pk: primaryKey({ columns: [t.runId, t.appId, t.skillId, t.kind] }) }));
sqliteTable("mail_sender_confirmations", { projectId: text$1("project_id").primaryKey(), bindingHash: text$1("binding_hash").notNull(), bindingJson: text$1("binding_json").notNull(), method: text$1("method").notNull(), receiptId: text$1("receipt_id").notNull().unique(), senderId: text$1("sender_id"), confirmedAt: text$1("confirmed_at").notNull(), recordHash: text$1("record_hash").notNull() });
const DB_VENDORS = {
  mysql: { label: "MySQL", transport: "mysql", defaultPort: 3306 },
  postgres: { label: "PostgreSQL", transport: "postgres", defaultPort: 5432 },
  opengauss: { label: "openGauss", transport: "postgres", defaultPort: 5432 },
  panweidb: { label: "盘维 PanweiDB", transport: "postgres", defaultPort: 5432 },
  kingbase: { label: "KingbaseES", transport: "postgres", defaultPort: 54321 },
  highgo: { label: "HighGo", transport: "postgres", defaultPort: 5866 },
  oceanbase: { label: "OceanBase (MySQL)", transport: "mysql", defaultPort: 2881 },
  goldendb: { label: "GoldenDB", transport: "mysql", defaultPort: 3306 }
};
const DB_VENDOR_IDS = Object.keys(DB_VENDORS);
const trimmed = (max) => string().trim().max(max);
const required = (max) => string().trim().min(1).max(max);
const optionalPath = string().trim().max(1024).nullable().transform((v) => v ? v : null);
const aliases = array(string()).max(50).transform((list) => [...new Set(list.map((a) => a.trim()).filter(Boolean))]);
const port$1 = number().int().min(1).max(65535);
const secretChange = string().max(4096).nullable().optional();
const projectInputSchema = object({
  name: required(100),
  aliases,
  description: trimmed(2e3),
  rulesPath: optionalPath
});
const dirInputSchema = object({
  label: trimmed(100),
  path: string().trim().min(1).max(1024).refine((p) => p.startsWith("/"), { message: "必须是绝对路径" })
});
const databaseInputSchema = object({
  env: required(32),
  label: trimmed(100),
  aliases,
  vendor: _enum(DB_VENDOR_IDS),
  host: required(255),
  port: port$1,
  database: trimmed(255),
  schema: string().trim().max(255).nullable().transform((v) => v ? v : null),
  username: required(255),
  accessLevel: _enum(["readonly", "readwrite"]),
  isDefault: boolean(),
  note: trimmed(2e3),
  password: secretChange
});
const serverInputSchema = object({
  env: required(32),
  label: trimmed(100),
  aliases,
  host: required(255),
  port: port$1,
  username: required(255),
  authType: _enum(["password", "key"]),
  privateKeyPath: optionalPath,
  defaultRoot: boolean(),
  sudoPolicy: _enum(["none", "same-as-login", "separate"]),
  appRoot: optionalPath,
  logsPath: optionalPath,
  note: trimmed(2e3),
  password: secretChange,
  passphrase: secretChange,
  sudoPassword: secretChange
}).refine((s) => s.authType !== "key" || Boolean(s.privateKeyPath), {
  message: "密钥认证需要填写私钥路径",
  path: ["privateKeyPath"]
});
const agentIdSchema = string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const envEntry = object({
  name: string().trim().regex(ENV_NAME_RE, { message: "变量名只能包含字母、数字和下划线，且不能以数字开头" }),
  secret: boolean(),
  /**
   * Plain variables: the value ('' when missing). Secret variables: undefined keeps the saved
   * value, null clears it, a string replaces it.
   */
  value: string().max(8192).nullable().optional()
});
const aiProfileInputSchema = object({
  name: string().trim().min(1).max(60),
  runner: agentIdSchema,
  /** null = the runner's own command, found on the login shell's PATH. */
  executable: string().trim().max(1024).nullable().transform((v) => v ? v : null).refine((v) => v === null || !/[\s'"`$;&|<>\\]/.test(v), { message: "只能是命令名或路径，不能包含空格和 shell 特殊字符" }),
  env: array(envEntry).max(100),
  args: array(string().max(4096)).max(50),
  color: string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  isDefault: boolean()
}).superRefine((p, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  p.env.forEach((e, i) => {
    if (seen.has(e.name)) ctx.addIssue({ code: "custom", path: ["env", i, "name"], message: `变量 ${e.name} 重复` });
    seen.add(e.name);
  });
});
class TransferError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const refSchema = string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const { password: _dbPassword, ...dbShape } = databaseInputSchema.shape;
const { password: _srvPassword, passphrase: _passphrase, sudoPassword: _sudo, privateKeyPath: _keyPath, ...serverShape } = serverInputSchema.shape;
const { isDefault: _default, env: _env, ...profileShape } = aiProfileInputSchema.shape;
const secretSchema = strictObject({
  password: string().max(4096).optional(),
  passphrase: string().max(4096).optional(),
  sudoPassword: string().max(4096).optional(),
  privateKey: strictObject({ encoding: literal("base64"), data: string().max(Math.ceil(TRANSFER_LIMITS.key / 3) * 4) }).optional(),
  env: record(string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(255), string().max(8192)).optional()
});
strictObject({
  schemaVersion: literal(1),
  exportedAt: string().datetime(),
  producer: strictObject({ name: string().max(100), appVersion: string().max(40), platform: string().max(40) }),
  project: projectInputSchema.strict(),
  directories: array(strictObject({ ref: refSchema, ...dirInputSchema.shape, isDefault: boolean() })).max(50),
  databases: array(strictObject({ ref: refSchema, ...dbShape })).max(100),
  servers: array(strictObject({ ref: refSchema, ...serverShape, privateKeyPath: _null() })).max(100),
  capabilities: array(strictObject({ id: _enum(TRANSFER_CAPABILITIES), enabled: boolean() })).length(3),
  profiles: array(strictObject({ ref: refSchema, ...profileShape, env: array(strictObject({ name: string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(255), secret: boolean(), value: string().max(8192).nullable() })).max(100) })).max(50),
  credentials: record(refSchema, secretSchema)
});
const PARAMS = { name: "scrypt", N: 131072, r: 8, p: 1 };
strictObject({
  format: literal("willyou.project"),
  version: literal(1),
  kdf: strictObject({ name: literal(PARAMS.name), N: literal(PARAMS.N), r: literal(PARAMS.r), p: literal(PARAMS.p), salt: string().max(32) }),
  cipher: strictObject({ name: literal("aes-256-gcm"), nonce: string().max(24), tag: string().max(32) }),
  ciphertext: string().max(Math.ceil(TRANSFER_LIMITS.payload / 3) * 4)
});
function readLimited(path2, limit = TRANSFER_LIMITS.file) {
  let fd;
  try {
    fd = node_fs.openSync(path2, node_fs.constants.O_RDONLY | node_fs.constants.O_NOFOLLOW | node_fs.constants.O_NONBLOCK);
    const stat = node_fs.fstatSync(fd);
    if (!stat.isFile()) throw new TransferError("FILE_IO_FAILED", "请选择可读取的普通文件");
    if (stat.size > limit) throw new TransferError("TOO_LARGE", "文件超过允许的大小");
    const data = Buffer.alloc(limit + 1);
    let total = 0;
    try {
      for (; ; ) {
        const n = node_fs.readSync(fd, data, total, data.length - total, null);
        total += n;
        if (!n || total === data.length) break;
      }
      if (total > limit) throw new TransferError("TOO_LARGE", "文件超过允许的大小");
      return Buffer.from(data.subarray(0, total));
    } finally {
      data.fill(0);
    }
  } catch (e) {
    if (e instanceof TransferError) throw e;
    throw new TransferError("FILE_IO_FAILED", "无法读取文件，请检查文件位置与访问权限");
  } finally {
    if (fd !== void 0) node_fs.closeSync(fd);
  }
}
function syncDirectory(path2) {
  const fd = node_fs.openSync(path2, node_fs.constants.O_RDONLY);
  try {
    node_fs.fsyncSync(fd);
  } finally {
    node_fs.closeSync(fd);
  }
}
function atomicWrite(path2, bytes, beforeRename) {
  const temporary = node_path.join(node_path.dirname(path2), `.willyou-${node_crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = node_fs.openSync(temporary, node_fs.constants.O_WRONLY | node_fs.constants.O_CREAT | node_fs.constants.O_EXCL | node_fs.constants.O_NOFOLLOW, 384);
    node_fs.writeFileSync(fd, bytes);
    node_fs.fsyncSync(fd);
    node_fs.closeSync(fd);
    fd = void 0;
    beforeRename?.();
    node_fs.renameSync(temporary, path2);
    syncDirectory(node_path.dirname(path2));
  } finally {
    if (fd !== void 0) node_fs.closeSync(fd);
    node_fs.rmSync(temporary, { force: true });
  }
}
strictObject({ requestId: string().uuid(), serverIds: array(string().uuid()).max(100) });
strictObject({ requestId: string().uuid(), serverId: string().uuid() });
const partitionSchema$1 = object({ topLevelSite: url().refine((value) => {
  const site = new URL(value);
  return ["http:", "https:"].includes(site.protocol) && !site.port && site.origin === value;
}), hasCrossSiteAncestor: boolean() }).strict();
const browserImportCookieSchema = object({
  name: string(),
  value: string(),
  domain: string().min(1),
  path: string().startsWith("/"),
  secure: boolean(),
  httpOnly: boolean(),
  hostOnly: boolean(),
  sameSite: _enum(["unspecified", "no_restriction", "lax", "strict"]),
  expirationDate: number().finite().nullable(),
  partitionKey: partitionSchema$1.nullable(),
  priority: _enum(["Low", "Medium", "High"]).optional(),
  sourceScheme: _enum(["Unset", "NonSecure", "Secure"]).optional(),
  sourcePort: number().int().min(-1).max(65535).optional()
}).strict().superRefine((cookie2, context) => {
  if (cookie2.hostOnly === cookie2.domain.startsWith(".")) context.addIssue({ code: "custom", message: "Cookie domain/host-only mismatch" });
  if (cookie2.sameSite === "no_restriction" && !cookie2.secure || cookie2.name.startsWith("__Secure-") && !cookie2.secure || cookie2.name.startsWith("__Host-") && (!cookie2.secure || !cookie2.hostOnly || cookie2.path !== "/")) context.addIssue({ code: "custom", message: "Cookie security attributes invalid" });
});
function browserImportCookieIdentity(cookie2) {
  return JSON.stringify([cookie2.name, cookie2.domain, cookie2.path, cookie2.partitionKey?.topLevelSite ?? null, cookie2.partitionKey?.hasCrossSiteAncestor ?? null]);
}
const changeSchema = object({ before: browserImportCookieSchema.nullable(), after: browserImportCookieSchema.nullable() }).strict().superRefine((change, context) => {
  if (!change.before && !change.after) context.addIssue({ code: "custom", message: "Empty cookie change" });
  if (change.before && change.after && browserImportCookieIdentity(change.before) !== browserImportCookieIdentity(change.after)) context.addIssue({ code: "custom", message: "Cookie identity changed" });
});
const browserImportJournalSchema = object({
  schemaVersion: literal(1),
  transactionId: uuid(),
  profileId: browserProfileSchema.shape.id,
  createdAt: number().int().nonnegative(),
  phase: _enum(["prepared", "committed"]).optional(),
  changes: array(changeSchema)
}).strict().superRefine((journal, context) => {
  const seen = /* @__PURE__ */ new Set();
  for (const change of journal.changes) {
    const cookie2 = change.before ?? change.after;
    if (!cookie2) continue;
    const id2 = browserImportCookieIdentity(cookie2);
    if (seen.has(id2)) context.addIssue({ code: "custom", message: "Duplicate cookie identity" });
    seen.add(id2);
  }
});
const LIMIT = 64 * 1024 * 1024;
class BrowserImportJournals {
  constructor(userData, cipher2) {
    this.cipher = cipher2;
    this.browserRoot = node_path.join(userData, "browser");
    this.directory = node_path.join(this.browserRoot, "import-journal");
  }
  browserRoot;
  directory;
  directories() {
    for (const path2 of [this.browserRoot, this.directory]) {
      node_fs.mkdirSync(path2, { recursive: true, mode: 448 });
      const stat = node_fs.lstatSync(path2);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApplicationError("BROWSER_UNAVAILABLE", "登录态恢复目录不可用，原记录已保留");
      node_fs.chmodSync(path2, 448);
    }
  }
  path(profileId) {
    const parsed = browserProfileSchema.shape.id.safeParse(profileId);
    if (!parsed.success) throw new ApplicationError("INVALID_INPUT", "登录态标识无效");
    return node_path.join(this.directory, parsed.data + ".bin");
  }
  available() {
    if (!this.cipher.isAvailable()) throw new ApplicationError("BROWSER_UNAVAILABLE", "系统加密存储不可用，恢复记录暂时不可读写");
  }
  exists(file) {
    try {
      const stat = node_fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new ApplicationError("BROWSER_UNAVAILABLE", "登录态恢复文件类型无效，原记录已保留");
      return true;
    } catch (error2) {
      if (error2 instanceof Error && "code" in error2 && error2.code === "ENOENT") return false;
      throw error2;
    }
  }
  pending() {
    this.directories();
    const ids = [];
    for (const name of node_fs.readdirSync(this.directory)) {
      if (!name.endsWith(".bin")) continue;
      const id2 = name.slice(0, -4);
      this.path(id2);
      ids.push(id2);
    }
    return ids.sort();
  }
  /** A user-confirmed clear must survive a crash even when the encrypted
   * rollback file cannot be decrypted. Only non-secret profile identity is
   * stored here. The marker is removed last, after data and rollback deletion. */
  clearIntent(profileId) {
    const file = this.path(profileId) + ".clear";
    if (!this.exists(file)) return null;
    try {
      const value = object({ schemaVersion: literal(1), profileId: browserProfileSchema.shape.id }).strict().parse(JSON.parse(readLimited(file, 4096).toString("utf8")));
      if (value.profileId !== profileId) throw Error();
      return file;
    } catch {
      throw new ApplicationError("BROWSER_UNAVAILABLE", "清空记录无法校验，原文件已保留");
    }
  }
  clearing() {
    this.directories();
    return node_fs.readdirSync(this.directory).filter((name) => name.endsWith(".bin.clear")).map((name) => {
      const id2 = name.slice(0, -10);
      this.clearIntent(id2);
      return id2;
    }).sort();
  }
  requestClear(profileId) {
    this.directories();
    const file = this.path(profileId) + ".clear";
    if (this.clearIntent(profileId)) return;
    atomicWrite(file, Buffer.from(JSON.stringify({ schemaVersion: 1, profileId })));
  }
  finishClear(profileId) {
    this.directories();
    const log = this.path(profileId), marker = log + ".clear";
    if (!this.clearIntent(profileId)) throw new ApplicationError("RESOURCE_STATE_CHANGED", "缺少已确认的清空记录");
    if (this.exists(log)) node_fs.unlinkSync(log);
    const sync = () => {
      const fd = node_fs.openSync(this.directory, node_fs.constants.O_RDONLY);
      try {
        node_fs.fsyncSync(fd);
      } finally {
        node_fs.closeSync(fd);
      }
    };
    sync();
    node_fs.unlinkSync(marker);
    sync();
  }
  write(input) {
    const parsed = browserImportJournalSchema.safeParse(input);
    if (!parsed.success) throw new ApplicationError("INVALID_INPUT", "登录态恢复变更集无效，未写入Cookie");
    this.available();
    this.directories();
    const file = this.path(parsed.data.profileId);
    if (this.exists(file)) throw new ApplicationError("RESOURCE_BUSY", "登录态仍有恢复日志，请先处理");
    const text2 = JSON.stringify(parsed.data);
    if (Buffer.byteLength(text2) > LIMIT) throw new ApplicationError("TOO_LARGE", "登录态恢复变更集超过64MiB，未写入Cookie");
    try {
      const bytes = this.cipher.encrypt(text2);
      if (bytes.length > LIMIT) throw new ApplicationError("TOO_LARGE", "加密恢复记录超过64MiB，未写入Cookie");
      atomicWrite(file, bytes);
    } catch (error2) {
      if (error2 instanceof ApplicationError) throw error2;
      throw new ApplicationError("BROWSER_UNAVAILABLE", "无法保存加密恢复日志，未写入Cookie");
    }
  }
  read(profileId) {
    this.directories();
    const file = this.path(profileId);
    if (!this.exists(file)) return null;
    this.available();
    try {
      const journal = browserImportJournalSchema.parse(JSON.parse(this.cipher.decrypt(readLimited(file, Math.min(LIMIT, node_fs.lstatSync(file).size)))));
      if (journal.profileId !== profileId) throw Error("Profile binding mismatch");
      return journal;
    } catch {
      throw new ApplicationError("BROWSER_UNAVAILABLE", "登录态恢复日志无法解密或校验，原文件已保留");
    }
  }
  /** Mark complete only after every native write and flush. A crash during
   * final file cleanup then cannot resurrect a prepared rollback transaction. */
  commit(profileId, transactionId) {
    const current = this.read(profileId);
    if (!current || current.transactionId !== transactionId) throw new ApplicationError("RESOURCE_STATE_CHANGED", "登录态恢复记录已变化");
    if (current.phase === "committed") return;
    const next = { ...current, phase: "committed" }, text2 = JSON.stringify(next);
    this.available();
    if (Buffer.byteLength(text2) > LIMIT) throw new ApplicationError("TOO_LARGE", "登录态完成记录超过64MiB");
    try {
      const bytes = this.cipher.encrypt(text2);
      if (bytes.length > LIMIT) throw new ApplicationError("TOO_LARGE", "加密完成记录超过64MiB");
      atomicWrite(this.path(profileId), bytes, () => {
        if (this.read(profileId)?.transactionId !== transactionId) throw new ApplicationError("RESOURCE_STATE_CHANGED", "登录态恢复记录已变化");
      });
    } catch (error2) {
      if (error2 instanceof ApplicationError) throw error2;
      throw new ApplicationError("BROWSER_UNAVAILABLE", "无法保存登录态完成状态，请先重试处理");
    }
  }
  remove(profileId, transactionId) {
    const journal = this.read(profileId);
    if (!journal) return;
    if (journal.transactionId !== transactionId) throw new ApplicationError("RESOURCE_STATE_CHANGED", "登录态恢复记录已变化，未删除");
    node_fs.unlinkSync(this.path(profileId));
    const fd = node_fs.openSync(this.directory, node_fs.constants.O_RDONLY);
    try {
      node_fs.fsyncSync(fd);
    } finally {
      node_fs.closeSync(fd);
    }
  }
}
const browserCookieFamilySchema = _enum(["chrome", "edge"]);
const browserCookieSourceSchema = object({
  id: string().regex(/^[0-9a-f]{64}$/),
  family: browserCookieFamilySchema,
  browserLabel: string(),
  profileName: string(),
  profileDirectory: string(),
  hasCookies: boolean()
}).strict();
class BrowserCookieSourceError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}
function deriveMacChromiumCookieKey(password) {
  return node_crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}
function decryptMacChromiumCookie({ encrypted, key, hostKey, version: version2 }) {
  let plain;
  try {
    if (key.length !== 16 || encrypted.subarray(0, 3).toString("ascii") !== "v10" || encrypted.length <= 3) throw Error();
    const decoder = node_crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
    plain = Buffer.concat([decoder.update(encrypted.subarray(3)), decoder.final()]);
    let value = plain;
    if (version2 >= 24) {
      const expected = node_crypto.createHash("sha256").update(hostKey).digest();
      if (plain.length < 32 || !node_crypto.timingSafeEqual(plain.subarray(0, 32), expected)) throw Error();
      value = plain.subarray(32);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new BrowserCookieSourceError("cookies-undecryptable", "无法解密来源Cookie；目标登录态尚未写入");
  } finally {
    plain?.fill(0);
  }
}
async function state(path2) {
  try {
    const s = await promises.lstat(path2, { bigint: true });
    if (!s.isFile() || s.isSymbolicLink()) throw new BrowserCookieSourceError("source-unreadable", "来源Cookie库不是普通文件");
    return { device: s.dev, inode: s.ino, size: s.size, modified: s.mtimeNs, changed: s.ctimeNs };
  } catch (error2) {
    if (error2 instanceof Error && "code" in error2 && error2.code === "ENOENT") return null;
    throw error2;
  }
}
function same(a, b) {
  return a === null || b === null ? a === b : a.device === b.device && a.inode === b.inode && a.size === b.size && a.modified === b.modified && a.changed === b.changed;
}
async function snapshotChromiumCookies(source, temporaryRoot = node_os.tmpdir()) {
  const directory = await promises.mkdtemp(node_path.join(temporaryRoot, "willyou-cookie-source-")), destination = node_path.join(directory, "Cookies");
  await promises.chmod(directory, 448);
  let kept = false;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const suffix of ["", "-wal", "-shm"]) await promises.rm(destination + suffix, { force: true });
      const before = await state(source), wal = await state(source + "-wal");
      if (!before) throw new BrowserCookieSourceError("source-missing", "找不到所选浏览器的Cookie库");
      await promises.copyFile(source, destination);
      await promises.chmod(destination, 384);
      if (wal) try {
        await promises.copyFile(source + "-wal", destination + "-wal");
        await promises.chmod(destination + "-wal", 384);
      } catch (error2) {
        if (error2 instanceof Error && "code" in error2 && error2.code === "ENOENT") continue;
        throw error2;
      }
      if (!same(before, await state(source)) || !same(wal, await state(source + "-wal"))) continue;
      if ((await state(destination))?.size !== before.size || (wal ? (await state(destination + "-wal"))?.size !== wal.size : await state(destination + "-wal") !== null)) continue;
      kept = true;
      return { path: destination, cleanup: () => promises.rm(directory, { recursive: true, force: true }) };
    }
    throw new BrowserCookieSourceError("source-unreadable", "复制期间来源Cookie库持续变化，请稍后重试");
  } catch (error2) {
    if (error2 instanceof BrowserCookieSourceError) throw error2;
    throw new BrowserCookieSourceError("source-unreadable", "无法读取所选浏览器的Cookie库");
  } finally {
    if (!kept) await promises.rm(directory, { recursive: true, force: true });
  }
}
function shareSameDomainSuffix(hostname, vhost) {
  if (hostname.endsWith(vhost)) {
    return hostname.length === vhost.length || hostname[hostname.length - vhost.length - 1] === ".";
  }
  return false;
}
function extractDomainWithSuffix(hostname, publicSuffix) {
  const publicSuffixIndex = hostname.length - publicSuffix.length - 2;
  const lastDotBeforeSuffixIndex = hostname.lastIndexOf(".", publicSuffixIndex);
  if (lastDotBeforeSuffixIndex === -1) {
    return hostname;
  }
  return hostname.slice(lastDotBeforeSuffixIndex + 1);
}
function getDomain(suffix, hostname, options) {
  if (options.validHosts !== null) {
    const validHosts = options.validHosts;
    for (const vhost of validHosts) {
      if (
        /*@__INLINE__*/
        shareSameDomainSuffix(hostname, vhost)
      ) {
        return vhost;
      }
    }
  }
  let numberOfLeadingDots = 0;
  if (hostname.startsWith(".")) {
    while (numberOfLeadingDots < hostname.length && hostname[numberOfLeadingDots] === ".") {
      numberOfLeadingDots += 1;
    }
  }
  if (suffix.length === hostname.length - numberOfLeadingDots) {
    return null;
  }
  return (
    /*@__INLINE__*/
    extractDomainWithSuffix(hostname, suffix)
  );
}
function getDomainWithoutSuffix(domain, suffix) {
  return domain.slice(0, -suffix.length - 1);
}
const CONTROL_CHARS = /[\t\n\r]/g;
let extractedHostnameValidated = false;
function isValidHostnameChar(code) {
  return code >= 97 && code <= 122 || // a-z
  code >= 48 && code <= 57 || // 0-9
  code > 127 || // non-ASCII (accepted, not punycode-checked)
  code >= 65 && code <= 90 || // A-Z (becomes valid once lowercased)
  code === 45 || // '-'
  code === 95;
}
function getSpecialScheme(url2, schemeStart, colonIndex) {
  const length = colonIndex - schemeStart;
  const c0 = url2.charCodeAt(schemeStart) | 32;
  if (length === 2) {
    return c0 === 119 && (url2.charCodeAt(schemeStart + 1) | 32) === 115 ? 1 : 0;
  } else if (length === 3) {
    const c1 = url2.charCodeAt(schemeStart + 1) | 32;
    const c2 = url2.charCodeAt(schemeStart + 2) | 32;
    if (c0 === 119 && c1 === 115 && c2 === 115)
      return 1;
    if (c0 === 102 && c1 === 116 && c2 === 112)
      return 1;
    return 0;
  } else if (length === 4) {
    const c1 = url2.charCodeAt(schemeStart + 1) | 32;
    const c2 = url2.charCodeAt(schemeStart + 2) | 32;
    const c3 = url2.charCodeAt(schemeStart + 3) | 32;
    if (c0 === 104 && c1 === 116 && c2 === 116 && c3 === 112)
      return 1;
    if (c0 === 102 && c1 === 105 && c2 === 108 && c3 === 101)
      return 2;
    return 0;
  } else if (length === 5) {
    return c0 === 104 && (url2.charCodeAt(schemeStart + 1) | 32) === 116 && (url2.charCodeAt(schemeStart + 2) | 32) === 116 && (url2.charCodeAt(schemeStart + 3) | 32) === 112 && (url2.charCodeAt(schemeStart + 4) | 32) === 115 ? 1 : 0;
  }
  return 0;
}
function extractHostname(url2, urlIsValidHostname, validate2 = false) {
  let start = 0;
  let end = url2.length;
  let hasUpper = false;
  let isSpecial = false;
  extractedHostnameValidated = false;
  if (!urlIsValidHostname) {
    if (url2.startsWith("data:")) {
      return null;
    }
    while (start < url2.length && url2.charCodeAt(start) <= 32) {
      start += 1;
    }
    while (end > start + 1 && url2.charCodeAt(end - 1) <= 32) {
      end -= 1;
    }
    if (url2.charCodeAt(start) === 47 && url2.charCodeAt(start + 1) === 47) {
      start += 2;
    } else {
      const indexOfProtocol = url2.indexOf(":/", start);
      if (indexOfProtocol !== -1) {
        const special = getSpecialScheme(url2, start, indexOfProtocol);
        if (special === 1) {
          isSpecial = true;
          start = indexOfProtocol + 2;
          while (url2.charCodeAt(start) === 47 || url2.charCodeAt(start) === 92) {
            start += 1;
          }
        } else if (special === 2) {
          isSpecial = true;
          start = indexOfProtocol + 1;
          let slashes = 0;
          while ((url2.charCodeAt(start) === 47 || url2.charCodeAt(start) === 92) && slashes < 2) {
            start += 1;
            slashes += 1;
          }
          if (slashes < 2) {
            return null;
          }
        } else {
          for (let i = start; i < indexOfProtocol; i += 1) {
            const code = url2.charCodeAt(i) | 32;
            if (!(code >= 97 && code <= 122 || // [a, z]
            code >= 48 && code <= 57 || // [0, 9]
            code === 46 || // '.'
            code === 45 || // '-'
            code === 43)) {
              const raw2 = url2.charCodeAt(i);
              if (raw2 === 9 || raw2 === 10 || raw2 === 13) {
                return extractHostname(url2.replace(CONTROL_CHARS, ""), urlIsValidHostname, validate2);
              }
              return null;
            }
          }
          if (url2.charCodeAt(indexOfProtocol + 2) === 47) {
            start = indexOfProtocol + 3;
          } else {
            return null;
          }
        }
      } else if (url2.charCodeAt(start) !== 91) {
        let indexOfColon = -1;
        for (let i = start; i < end; i += 1) {
          const code = url2.charCodeAt(i);
          if (code === 9 || code === 10 || code === 13) {
            return extractHostname(url2.replace(CONTROL_CHARS, ""), urlIsValidHostname, validate2);
          }
          if (code === 58) {
            indexOfColon = i;
            break;
          }
          if (code === 47 || code === 92 || code === 63 || code === 35) {
            break;
          }
        }
        if (indexOfColon !== -1) {
          let hasIdentifier = false;
          for (let i = indexOfColon + 1; i < end; i += 1) {
            const code = url2.charCodeAt(i);
            if (code === 47 || code === 92 || code === 63 || code === 35) {
              break;
            }
            if (code === 64) {
              hasIdentifier = true;
              break;
            }
          }
          if (!hasIdentifier) {
            let allDigits = true;
            let i = indexOfColon + 1;
            for (; i < end; i += 1) {
              const code = url2.charCodeAt(i);
              if (code === 47 || code === 92 || code === 63 || code === 35) {
                break;
              }
              if (code < 48 || code > 57) {
                allDigits = false;
                break;
              }
            }
            if (i === indexOfColon + 1) {
              allDigits = false;
            }
            if (!allDigits) {
              const special = getSpecialScheme(url2, start, indexOfColon);
              if (special === 0) {
                let isBareIpv6 = false;
                for (let j = indexOfColon + 1; j < end; j += 1) {
                  const code = url2.charCodeAt(j);
                  if (code === 47 || code === 92 || code === 63 || code === 35) {
                    break;
                  }
                  if (code === 58) {
                    isBareIpv6 = true;
                    break;
                  }
                }
                if (!isBareIpv6) {
                  return null;
                }
              } else {
                isSpecial = true;
                start = indexOfColon + 1;
                if (special === 2) {
                  let slashes = 0;
                  while ((url2.charCodeAt(start) === 47 || url2.charCodeAt(start) === 92) && slashes < 2) {
                    start += 1;
                    slashes += 1;
                  }
                  if (slashes < 2) {
                    return null;
                  }
                } else {
                  while (url2.charCodeAt(start) === 47 || url2.charCodeAt(start) === 92) {
                    start += 1;
                  }
                }
              }
            }
          }
        }
      }
    }
    let indexOfIdentifier = -1;
    let indexOfClosingBracket = -1;
    let indexOfPort = -1;
    let indexOfFirstColon = -1;
    let hasControl = false;
    let vValid = validate2;
    let vLastDot = start - 1;
    let vLastCode = -1;
    if (validate2 && start < end) {
      const c0 = url2.charCodeAt(start);
      if (
        // Keep these parens: they scope /*@__INLINE__*/ for terser.
        // prettier-ignore
        !/*@__INLINE__*/
        (isValidHostnameChar(c0) || c0 === 46 || c0 === 95) || c0 === 45
      ) {
        vValid = false;
      }
    }
    for (let i = start; i < end; i += 1) {
      const code = url2.charCodeAt(i);
      if (code < 64) {
        if (code === 47 || code === 35 || code === 63) {
          end = i;
          break;
        } else if (code === 58) {
          if (indexOfFirstColon === -1) {
            indexOfFirstColon = i;
          }
          indexOfPort = i;
        } else if (code === 9 || code === 10 || code === 13) {
          hasControl = true;
        } else if (validate2) {
          if (code === 46) {
            if (i - vLastDot > 64 || vLastCode === 46 || vLastCode === 45) {
              vValid = false;
            }
            vLastDot = i;
          } else if (code < 48 || code > 57) {
            if (code !== 45 || vLastCode === 46) {
              vValid = false;
            }
          }
        }
      } else if (isSpecial && code === 92) {
        end = i;
        break;
      } else if (code === 64) {
        indexOfIdentifier = i;
        indexOfFirstColon = -1;
      } else if (code === 93) {
        indexOfClosingBracket = i;
      } else if (code >= 65 && code <= 90) {
        hasUpper = true;
      } else if (validate2 && !/*@__INLINE__*/
      isValidHostnameChar(code)) {
        vValid = false;
      }
      if (validate2) {
        vLastCode = code;
      }
    }
    if (hasControl) {
      return extractHostname(url2.replace(CONTROL_CHARS, ""), urlIsValidHostname, validate2);
    }
    if (indexOfIdentifier !== -1 && indexOfIdentifier >= start && indexOfIdentifier < end) {
      start = indexOfIdentifier + 1;
    }
    if (url2.charCodeAt(start) === 91) {
      if (indexOfClosingBracket !== -1) {
        return url2.slice(start + 1, indexOfClosingBracket).toLowerCase();
      }
      return null;
    } else if (indexOfPort !== -1 && indexOfPort > start && indexOfPort < end && // A host:port has exactly one ':' in the host (so its first ':' is its
    // last); a bare, unbracketed IPv6 literal ("2a01:e35::1") has >= 2, so
    // its first ':' precedes the last. Only the former has a ':port' to trim.
    indexOfFirstColon === indexOfPort) {
      end = indexOfPort;
    }
    if (start >= end) {
      return null;
    }
    if (validate2 && vValid && indexOfIdentifier === -1 && indexOfPort === -1 && indexOfClosingBracket === -1 && url2.charCodeAt(end - 1) !== 46 && end - start <= 255 && // total length
    end - vLastDot - 1 <= 63 && // last label length
    vLastCode !== 45) {
      extractedHostnameValidated = true;
    }
  }
  while (end > start + 1 && url2.charCodeAt(end - 1) === 46) {
    end -= 1;
  }
  const hostname = start !== 0 || end !== url2.length ? url2.slice(start, end) : url2;
  if (hasUpper) {
    return hostname.toLowerCase();
  }
  return hostname;
}
function isProbablyIpv4(hostname) {
  if (hostname.length < 7) {
    return false;
  }
  if (hostname.length > 15) {
    return false;
  }
  let numberOfDots = 0;
  for (let i = 0; i < hostname.length; i += 1) {
    const code = hostname.charCodeAt(i);
    if (code === 46) {
      numberOfDots += 1;
    } else if (code < 48 || code > 57) {
      return false;
    }
  }
  return numberOfDots === 3 && hostname.charCodeAt(0) !== 46 && hostname.charCodeAt(hostname.length - 1) !== 46;
}
function isProbablyIpv6(hostname) {
  if (hostname.length < 3) {
    return false;
  }
  let start = hostname.startsWith("[") ? 1 : 0;
  let end = hostname.length;
  if (hostname[end - 1] === "]") {
    end -= 1;
  }
  if (end - start > 39) {
    return false;
  }
  let hasColon = false;
  for (; start < end; start += 1) {
    const code = hostname.charCodeAt(start);
    if (code === 58) {
      hasColon = true;
    } else if (!(code >= 48 && code <= 57 || // 0-9
    code >= 97 && code <= 102 || // a-f
    code >= 65 && code <= 70)) {
      return false;
    }
  }
  return hasColon;
}
function isIp(hostname) {
  return isProbablyIpv6(hostname) || isProbablyIpv4(hostname);
}
const SPECIAL_USE_DOMAINS = [
  "test",
  // RFC 6761
  "localhost",
  // RFC 6761
  "invalid",
  // RFC 6761
  "example",
  // RFC 6761
  "example.com",
  // RFC 6761
  "example.net",
  // RFC 6761
  "example.org",
  // RFC 6761
  "local",
  // RFC 6762 (mDNS)
  "onion",
  // RFC 7686 (Tor)
  "alt",
  // RFC 9476
  "home.arpa",
  // RFC 8375
  "ipv4only.arpa",
  // RFC 8880
  "resolver.arpa",
  // RFC 9462
  "service.arpa",
  // RFC 9665
  "6tisch.arpa",
  // RFC 9031
  "eap.arpa"
  // RFC 9965
];
function isSpecialUse(hostname) {
  for (const name of SPECIAL_USE_DOMAINS) {
    if (hostname.endsWith(name) && (hostname.length === name.length || hostname.charCodeAt(hostname.length - name.length - 1) === 46)) {
      return true;
    }
  }
  return false;
}
function isValidAscii(code) {
  return code >= 97 && code <= 122 || code >= 48 && code <= 57 || code > 127;
}
function isValidHostname(hostname) {
  if (hostname.length > 255) {
    return false;
  }
  if (hostname.length === 0) {
    return false;
  }
  if (
    /*@__INLINE__*/
    !isValidAscii(hostname.charCodeAt(0)) && hostname.charCodeAt(0) !== 46 && // '.' (dot)
    hostname.charCodeAt(0) !== 95
  ) {
    return false;
  }
  let lastDotIndex = -1;
  let lastCharCode = -1;
  const len = hostname.length;
  for (let i = 0; i < len; i += 1) {
    const code = hostname.charCodeAt(i);
    if (code === 46) {
      if (
        // Check that previous label is < 63 bytes long (64 = 63 + '.')
        i - lastDotIndex > 64 || // Check that previous character was not already a '.'
        lastCharCode === 46 || // Check that the previous label does not end with '-' (RFC 1035 §2.3.1 LDH).
        // '_' is intentionally NOT restricted: DNS allows any octet (RFC 2181 §11) and
        // WHATWG URL does not treat '_' as a forbidden host code point.
        lastCharCode === 45
      ) {
        return false;
      }
      lastDotIndex = i;
    } else if (
      // A forbidden character in the label...
      // Keep these parens: they scope /*@__INLINE__*/ for terser.
      // prettier-ignore
      !/*@__INLINE__*/
      (isValidAscii(code) || code === 45 || code === 95) || // ...or a '-' starting a label (the byte right after a '.'). A label must
      // not begin with a hyphen (RFC 1034 §3.5 / RFC 1035 §2.3.1 LDH, as amended
      // by RFC 1123 §2.1; cf. UTS #46 CheckHyphens). The first label is covered by
      // the leading-character guard above; mirrors the trailing-'-' rule below.
      code === 45 && lastCharCode === 46
    ) {
      return false;
    }
    lastCharCode = code;
  }
  return (
    // Check that last label is shorter than 63 chars
    len - lastDotIndex - 1 <= 63 && // Check that the last character is an allowed trailing label character.
    // Since we already checked that the char is a valid hostname character,
    // we only need to check that it's different from '-'.
    lastCharCode !== 45
  );
}
function setDefaultsImpl({ allowIcannDomains = true, allowPrivateDomains = false, detectIp = true, detectSpecialUse = false, extractHostname: extractHostname2 = true, mixedInputs = true, validHosts = null, validateHostname = true }) {
  return {
    allowIcannDomains,
    allowPrivateDomains,
    detectIp,
    detectSpecialUse,
    extractHostname: extractHostname2,
    mixedInputs,
    validHosts,
    validateHostname
  };
}
const DEFAULT_OPTIONS = (
  /*@__INLINE__*/
  setDefaultsImpl({})
);
function setDefaults(options) {
  if (options === void 0) {
    return DEFAULT_OPTIONS;
  }
  return (
    /*@__INLINE__*/
    setDefaultsImpl(options)
  );
}
function getSubdomain(hostname, domain) {
  if (domain.length === hostname.length) {
    return "";
  }
  return hostname.slice(0, -domain.length - 1);
}
function getEmptyResult() {
  return {
    domain: null,
    domainWithoutSuffix: null,
    hostname: null,
    isIcann: null,
    isIp: null,
    isPrivate: null,
    isSpecialUse: null,
    publicSuffix: null,
    subdomain: null
  };
}
function parseImpl(url2, step, suffixLookup2, partialOptions, result) {
  const options = (
    /*@__INLINE__*/
    setDefaults(partialOptions)
  );
  if (typeof url2 !== "string") {
    return result;
  }
  let urlIsValid = false;
  if (!options.extractHostname) {
    result.hostname = url2;
  } else if (options.mixedInputs) {
    urlIsValid = isValidHostname(url2);
    result.hostname = extractHostname(url2, urlIsValid, options.validateHostname);
  } else {
    result.hostname = extractHostname(url2, false, options.validateHostname);
  }
  if (options.detectIp && result.hostname !== null) {
    result.isIp = isIp(result.hostname);
    if (result.isIp) {
      return result;
    }
  }
  if (options.validateHostname && options.extractHostname && result.hostname !== null && // Skip the re-scan when `url` was already validated and extractHostname
  // returned it unchanged (same reference => identical string, still valid).
  !(urlIsValid && result.hostname === url2) && // Skip the re-scan when extractHostname already validated the host inline
  // (a confirmed-valid simple authority — see extract-hostname.ts).
  !extractedHostnameValidated && !isValidHostname(result.hostname)) {
    result.hostname = null;
    return result;
  }
  if (result.hostname === null) {
    return result;
  }
  if (options.detectSpecialUse) {
    result.isSpecialUse = isSpecialUse(result.hostname);
  }
  suffixLookup2(result.hostname, options, result);
  if (result.publicSuffix === null) {
    return result;
  }
  result.domain = getDomain(result.publicSuffix, result.hostname, options);
  if (result.domain === null) {
    return result;
  }
  result.subdomain = getSubdomain(result.hostname, result.domain);
  result.domainWithoutSuffix = getDomainWithoutSuffix(result.domain, result.publicSuffix);
  return result;
}
function fastPathLookup(hostname, options, out) {
  if (!options.allowPrivateDomains && hostname.length > 3) {
    const last = hostname.length - 1;
    const c3 = hostname.charCodeAt(last);
    const c2 = hostname.charCodeAt(last - 1);
    const c1 = hostname.charCodeAt(last - 2);
    const c0 = hostname.charCodeAt(last - 3);
    if (c3 === 109 && c2 === 111 && c1 === 99 && c0 === 46) {
      out.isIcann = true;
      out.isPrivate = false;
      out.publicSuffix = "com";
      return true;
    } else if (c3 === 103 && c2 === 114 && c1 === 111 && c0 === 46) {
      out.isIcann = true;
      out.isPrivate = false;
      out.publicSuffix = "org";
      return true;
    } else if (c3 === 117 && c2 === 100 && c1 === 101 && c0 === 46) {
      out.isIcann = true;
      out.isPrivate = false;
      out.publicSuffix = "edu";
      return true;
    } else if (c3 === 118 && c2 === 111 && c1 === 103 && c0 === 46) {
      out.isIcann = true;
      out.isPrivate = false;
      out.publicSuffix = "gov";
      return true;
    } else if (c3 === 116 && c2 === 101 && c1 === 110 && c0 === 46) {
      out.isIcann = true;
      out.isPrivate = false;
      out.publicSuffix = "net";
      return true;
    } else if (c3 === 101 && c2 === 100 && c1 === 46) {
      out.isIcann = true;
      out.isPrivate = false;
      out.publicSuffix = "de";
      return true;
    }
  }
  return false;
}
const nodeFlags = /* @__PURE__ */ new Uint8Array([1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2, 0, 2, 0, 0, 1, 0, 0, 2, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 2, 2, 0, 0, 0, 2, 0, 1, 1, 0, 2, 0, 2, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 2, 2, 0, 2, 2, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 2, 2, 0, 2, 2, 2, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 2, 2, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 2, 2, 0, 0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 2, 2, 1, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
const edgeStart = /* @__PURE__ */ new Uint16Array([0, 0, 0, 10, 11, 18, 106, 111, 117, 124, 130, 136, 145, 146, 147, 148, 149, 150, 151, 153, 154, 155, 157, 159, 228, 241, 243, 244, 245, 260, 267, 268, 271, 272, 273, 276, 278, 297, 298, 300, 309, 314, 331, 332, 335, 337, 338, 340, 374, 375, 377, 380, 381, 385, 387, 391, 394, 426, 429, 442, 443, 451, 452, 454, 464, 478, 479, 480, 481, 490, 491, 528, 533, 549, 569, 575, 617, 618, 645, 672, 673, 821, 827, 830, 831, 832, 837, 842, 851, 873, 874, 875, 876, 877, 878, 879, 897, 899, 900, 903, 905, 906, 908, 910, 925, 940, 945, 946, 948, 949, 950, 951, 952, 954, 957, 962, 963, 964, 966, 967, 970, 973, 974, 975, 988, 990, 1002, 1013, 1021, 1023, 1064, 1067, 1071, 1072, 1074, 1077, 1088, 1090, 1100, 1102, 1108, 1110, 1111, 1113, 1116, 1117, 1118, 1171, 1173, 1175, 1195, 1196, 1197, 1198, 1200, 1211, 1242, 1253, 1265, 1274, 1281, 1286, 1299, 1310, 1323, 1324, 1335, 1369, 1370, 1371, 1386, 1401, 1473, 1474, 1476, 1477, 1513, 1532, 1533, 1534, 1535, 1536, 1539, 1543, 1546, 1548, 1582, 1583, 1591, 1592, 1593, 1594, 1596, 1598, 1599, 1601, 1602, 1603, 1614, 1615, 1616, 1617, 1618, 1619, 1620, 1621, 1622, 1623, 1624, 1625, 1626, 1627, 1629, 1630, 1631, 2086, 2089, 2090, 2092, 2099, 2106, 2116, 2120, 2131, 2132, 2133, 2145, 2146, 2148, 2150, 2151, 2158, 2159, 2161, 2162, 2164, 2165, 2166, 2167, 2168, 2242, 2244, 2265, 2266, 2267, 2269, 2271, 2272, 2323, 2324, 2326, 2333, 2339, 2349, 2359, 2412, 2413, 2414, 2424, 2438, 2439, 2442, 2449, 2450, 2458, 2459, 2460, 2461, 2462, 2473, 2474, 2475, 2477, 2478, 2479, 2488, 2500, 2506, 2538, 2542, 2544, 2545, 2547, 2548, 2559, 2560, 2562, 2570, 2577, 2583, 2588, 2589, 2595, 2598, 2604, 2611, 2612, 2619, 2627, 2628, 2629, 2667, 2673, 2688, 2689, 2694, 2712, 2743, 2761, 2763, 2766, 2774, 2776, 2783, 2835, 2859, 2860, 2861, 2862, 2863, 2864, 2865, 2872, 2873, 2874, 2875, 2876, 2877, 2879, 2880, 2884, 2964, 2977, 2978, 3415, 3419, 3433, 3485, 3513, 3535, 3593, 3615, 3630, 3693, 3744, 3782, 3818, 3843, 3985, 4031, 4082, 4101, 4135, 4150, 4170, 4200, 4231, 4254, 4285, 4315, 4347, 4374, 4449, 4471, 4509, 4519, 4553, 4572, 4598, 4640, 4690, 4716, 4785, 4786, 4788, 4811, 4834, 4870, 4901, 4918, 4975, 4988, 5012, 5041, 5043, 5077, 5093, 5121, 5426, 5435, 5444, 5451, 5468, 5472, 5478, 5517, 5519, 5526, 5533, 5542, 5549, 5550, 5551, 5563, 5566, 5581, 5582, 5591, 5592, 5601, 5610, 5616, 5618, 5619, 5620, 5657, 5658, 5660, 5668, 5675, 5688, 5692, 5694, 5695, 5701, 5708, 5722, 5732, 5737, 5745, 5753, 5759, 5760, 5764, 5766, 5767, 5779, 5851, 5852, 5853, 5854, 5856, 5857, 5860, 5862, 5865, 5869, 5870, 5871, 5877, 5878, 5879, 5881, 5883, 5885, 5886, 5887, 5890, 5892, 5895, 5896, 5898, 6096, 6103, 6104, 6105, 6115, 6120, 6137, 6151, 6160, 6161, 6162, 6166, 6167, 6169, 6171, 6177, 6178, 6181, 6182, 6184, 6185, 6186, 7086, 7089, 7093, 7111, 7120, 7123, 7130, 7131, 7133, 7134, 7135, 7137, 7189, 7190, 7193, 7194, 7311, 7312, 7323, 7334, 7341, 7344, 7353, 7354, 7355, 7370, 7425, 7617, 7619, 7620, 7622, 7627, 7640, 7655, 7662, 7671, 7674, 7677, 7684, 7692, 7696, 7697, 7698, 7712, 7716, 7725, 7726, 7727, 7731, 7766, 7767, 7785, 7792, 7800, 7801, 7806, 7814, 7858, 7859, 7865, 7868, 7880, 7885, 7886, 7889, 7891, 7926, 7927, 7933, 7940, 7941, 7950, 7959, 7974, 7978, 7979, 8031, 8032, 8037, 8039, 8042, 8044, 8045, 8046, 8055, 8069, 8077, 8091, 8103, 8104, 8106, 8108, 8130, 8141, 8147, 8148, 8160, 8172, 8259, 8271, 8279, 8282, 8288, 8313, 8316, 8317, 8318, 8319, 8321, 8324, 8327, 8338, 8340, 8342, 8370, 8445, 8452, 8456, 8457, 8466, 8488, 8489, 8494, 8495, 8574, 8576, 8578, 8587, 8591, 8597, 8603, 8609, 8619, 8624, 8625, 8643, 8654, 8659, 8664, 8674, 8680, 8684, 8690, 8696, 10304, 10305, 10306, 10313, 10315]);
const edgeLength = /* @__PURE__ */ new Uint8Array([3, 3, 3, 3, 3, 3, 3, 3, 5, 8, 8, 2, 2, 3, 3, 3, 3, 3, 8, 5, 5, 5, 5, 5, 3, 3, 5, 5, 9, 12, 19, 8, 19, 8, 11, 9, 9, 8, 7, 7, 6, 8, 9, 16, 10, 7, 7, 11, 8, 6, 6, 9, 7, 11, 7, 14, 4, 4, 4, 4, 4, 4, 10, 7, 6, 6, 6, 6, 10, 10, 6, 10, 10, 22, 11, 9, 10, 10, 10, 9, 10, 8, 7, 7, 7, 8, 21, 13, 11, 11, 9, 10, 9, 13, 10, 8, 8, 9, 12, 9, 7, 10, 7, 7, 13, 7, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 8, 6, 3, 3, 3, 3, 3, 3, 2, 5, 3, 3, 3, 7, 2, 2, 2, 2, 2, 2, 3, 3, 3, 1, 1, 7, 8, 5, 2, 2, 7, 2, 2, 1, 4, 1, 11, 9, 9, 5, 5, 8, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 5, 11, 9, 9, 13, 7, 14, 7, 6, 6, 6, 7, 6, 6, 6, 6, 6, 6, 10, 7, 11, 9, 4, 4, 4, 4, 4, 6, 6, 6, 6, 13, 6, 8, 7, 10, 9, 9, 7, 9, 8, 9, 8, 7, 10, 6, 9, 8, 10, 10, 7, 8, 1, 9, 10, 12, 12, 12, 10, 9, 9, 10, 10, 9, 9, 1, 1, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 6, 6, 4, 3, 3, 3, 7, 4, 4, 4, 3, 3, 6, 7, 3, 4, 1, 2, 2, 2, 6, 1, 2, 2, 2, 2, 2, 12, 5, 3, 8, 9, 13, 4, 4, 13, 9, 9, 11, 7, 3, 12, 9, 2, 2, 2, 3, 3, 3, 3, 3, 8, 2, 2, 3, 3, 3, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 3, 7, 10, 15, 7, 15, 15, 20, 15, 9, 10, 10, 12, 14, 14, 14, 12, 12, 12, 12, 12, 14, 14, 10, 10, 10, 10, 14, 9, 9, 9, 10, 14, 14, 14, 13, 13, 9, 9, 9, 9, 9, 9, 7, 8, 6, 8, 8, 6, 8, 13, 8, 8, 6, 13, 8, 11, 13, 8, 6, 13, 8, 6, 9, 10, 10, 12, 14, 14, 14, 12, 12, 12, 12, 14, 14, 10, 10, 10, 10, 9, 9, 9, 10, 14, 14, 11, 13, 13, 9, 9, 9, 9, 9, 9, 2, 6, 9, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 2, 3, 3, 3, 3, 3, 3, 7, 7, 2, 3, 2, 2, 5, 3, 3, 3, 3, 3, 3, 4, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 5, 7, 4, 2, 2, 12, 8, 10, 8, 10, 7, 18, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 2, 2, 3, 3, 3, 5, 5, 3, 8, 8, 6, 8, 6, 6, 4, 6, 7, 7, 7, 10, 11, 2, 5, 5, 3, 3, 3, 3, 3, 3, 5, 5, 6, 11, 10, 7, 7, 7, 4, 4, 4, 2, 3, 3, 3, 3, 3, 2, 2, 7, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 7, 7, 7, 11, 7, 6, 9, 6, 6, 8, 10, 8, 6, 8, 13, 4, 4, 4, 4, 4, 10, 8, 11, 8, 8, 8, 10, 10, 7, 10, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 7, 10, 13, 7, 8, 7, 11, 8, 8, 6, 9, 8, 8, 6, 6, 6, 8, 8, 6, 6, 6, 6, 6, 9, 7, 6, 4, 4, 4, 4, 4, 4, 4, 6, 6, 6, 9, 7, 8, 10, 8, 8, 2, 3, 3, 3, 3, 3, 2, 8, 9, 9, 2, 2, 2, 3, 3, 3, 2, 3, 3, 3, 9, 2, 2, 3, 3, 3, 3, 3, 3, 5, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 12, 5, 5, 3, 5, 4, 2, 3, 2, 4, 3, 9, 2, 2, 2, 2, 2, 5, 5, 3, 8, 8, 13, 6, 10, 9, 4, 7, 9, 11, 2, 3, 7, 3, 3, 4, 1, 3, 4, 2, 9, 3, 3, 12, 5, 3, 7, 10, 10, 7, 4, 4, 6, 14, 7, 9, 7, 13, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 8, 15, 4, 4, 2, 3, 3, 3, 7, 4, 9, 9, 2, 3, 3, 3, 5, 3, 2, 2, 7, 2, 7, 6, 6, 7, 2, 4, 2, 2, 2, 2, 2, 2, 8, 8, 8, 9, 5, 2, 3, 3, 3, 3, 3, 3, 10, 7, 4, 4, 4, 4, 3, 4, 2, 3, 3, 3, 3, 3, 10, 7, 4, 4, 4, 4, 2, 3, 3, 3, 3, 10, 7, 4, 4, 4, 4, 3, 9, 6, 6, 6, 9, 13, 9, 2, 2, 2, 8, 7, 9, 5, 3, 3, 3, 5, 5, 13, 12, 9, 10, 7, 8, 7, 6, 8, 6, 11, 12, 7, 9, 10, 4, 4, 7, 8, 11, 6, 7, 9, 8, 7, 10, 8, 9, 15, 7, 8, 5, 4, 7, 2, 3, 3, 3, 2, 14, 10, 2, 14, 10, 2, 14, 3, 9, 13, 13, 10, 14, 16, 17, 11, 2, 14, 2, 14, 3, 9, 13, 10, 14, 16, 17, 11, 14, 10, 14, 2, 7, 3, 10, 7, 14, 10, 2, 14, 10, 9, 9, 17, 6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 10, 10, 10, 12, 9, 4, 10, 10, 11, 8, 8, 8, 7, 9, 5, 3, 3, 3, 3, 3, 3, 3, 3, 5, 8, 4, 4, 4, 4, 4, 4, 6, 16, 3, 3, 14, 3, 14, 2, 14, 9, 13, 10, 10, 14, 16, 17, 11, 6, 9, 10, 10, 12, 14, 14, 14, 12, 12, 12, 12, 14, 14, 10, 10, 10, 10, 14, 9, 9, 9, 10, 14, 14, 14, 9, 9, 9, 9, 9, 9, 2, 14, 9, 13, 10, 10, 14, 16, 17, 11, 6, 2, 14, 9, 17, 13, 10, 10, 14, 16, 17, 11, 6, 2, 14, 9, 13, 10, 14, 16, 17, 11, 2, 14, 9, 13, 10, 16, 11, 2, 14, 10, 19, 7, 2, 14, 9, 13, 10, 19, 10, 7, 14, 16, 17, 11, 6, 2, 14, 9, 13, 10, 19, 7, 14, 16, 17, 11, 2, 14, 9, 13, 17, 13, 10, 10, 14, 16, 17, 11, 6, 3, 2, 14, 9, 13, 10, 10, 14, 16, 17, 11, 6, 9, 10, 12, 14, 14, 14, 12, 12, 12, 12, 12, 14, 14, 14, 10, 10, 10, 14, 9, 9, 9, 9, 14, 14, 14, 13, 13, 14, 9, 9, 9, 9, 9, 9, 4, 11, 2, 14, 9, 13, 17, 13, 10, 19, 10, 7, 14, 16, 17, 11, 6, 2, 14, 9, 13, 17, 13, 10, 19, 10, 7, 14, 16, 17, 11, 6, 2, 9, 10, 10, 7, 17, 3, 3, 12, 12, 16, 15, 15, 12, 14, 14, 14, 20, 20, 13, 12, 12, 12, 12, 12, 12, 20, 25, 14, 14, 12, 12, 10, 10, 10, 10, 9, 9, 9, 25, 4, 9, 17, 10, 7, 14, 16, 21, 13, 13, 14, 20, 14, 13, 17, 24, 9, 12, 13, 25, 13, 21, 20, 17, 9, 9, 9, 9, 9, 9, 12, 17, 4, 4, 9, 9, 9, 10, 10, 12, 14, 14, 14, 12, 12, 12, 12, 12, 14, 14, 10, 10, 10, 10, 14, 9, 9, 9, 9, 10, 14, 14, 14, 13, 13, 14, 9, 9, 9, 9, 9, 9, 9, 10, 14, 12, 12, 14, 14, 10, 9, 9, 9, 10, 14, 14, 14, 9, 9, 9, 9, 2, 1, 5, 8, 7, 11, 11, 1, 3, 3, 3, 5, 3, 3, 4, 8, 9, 10, 10, 12, 14, 14, 14, 12, 12, 12, 12, 14, 14, 10, 10, 10, 10, 14, 9, 9, 9, 10, 14, 14, 14, 13, 13, 14, 9, 9, 9, 9, 9, 9, 7, 4, 4, 4, 4, 4, 4, 4, 4, 4, 7, 4, 9, 12, 6, 14, 4, 12, 7, 2, 2, 1, 2, 7, 6, 4, 4, 4, 6, 8, 8, 7, 4, 5, 6, 3, 3, 3, 3, 4, 16, 8, 5, 4, 3, 3, 3, 5, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 11, 12, 7, 7, 13, 9, 10, 17, 12, 8, 9, 7, 8, 5, 12, 10, 13, 14, 5, 5, 5, 13, 5, 5, 5, 3, 3, 3, 5, 16, 5, 5, 5, 5, 7, 12, 14, 8, 12, 8, 10, 12, 9, 11, 7, 9, 7, 10, 7, 13, 9, 7, 12, 8, 17, 7, 7, 16, 10, 13, 13, 8, 10, 10, 14, 17, 7, 16, 16, 15, 8, 10, 10, 12, 17, 17, 7, 17, 14, 7, 10, 17, 8, 7, 7, 7, 8, 15, 15, 7, 14, 10, 10, 10, 11, 11, 7, 7, 13, 8, 10, 7, 16, 7, 8, 7, 14, 17, 12, 10, 11, 21, 8, 9, 7, 13, 9, 8, 13, 6, 12, 7, 6, 13, 10, 10, 10, 8, 18, 9, 17, 13, 10, 12, 6, 13, 6, 11, 8, 13, 10, 13, 18, 13, 11, 13, 8, 16, 7, 10, 8, 16, 12, 10, 8, 8, 14, 11, 8, 15, 8, 8, 7, 7, 12, 7, 8, 9, 14, 15, 8, 9, 10, 9, 15, 7, 8, 8, 12, 13, 9, 10, 15, 13, 7, 10, 10, 20, 7, 6, 9, 6, 6, 14, 11, 14, 11, 12, 9, 10, 16, 16, 12, 7, 11, 28, 8, 11, 10, 7, 21, 8, 7, 9, 4, 4, 4, 17, 7, 8, 6, 9, 6, 6, 13, 6, 6, 6, 6, 18, 20, 14, 8, 11, 12, 9, 10, 13, 15, 15, 19, 8, 9, 12, 7, 10, 16, 12, 9, 9, 9, 14, 12, 11, 9, 12, 11, 18, 9, 9, 9, 10, 7, 7, 16, 8, 9, 7, 13, 12, 10, 14, 18, 7, 8, 11, 7, 7, 8, 8, 13, 7, 7, 7, 11, 15, 13, 11, 7, 8, 15, 11, 7, 8, 18, 14, 13, 18, 15, 10, 12, 12, 9, 7, 11, 11, 8, 7, 10, 8, 14, 12, 10, 18, 7, 10, 9, 7, 8, 13, 10, 14, 10, 8, 8, 23, 7, 7, 11, 12, 12, 17, 7, 7, 11, 11, 17, 16, 16, 7, 8, 11, 14, 14, 8, 10, 7, 7, 16, 16, 13, 9, 11, 9, 15, 15, 11, 11, 7, 7, 14, 7, 9, 7, 7, 16, 10, 13, 10, 11, 14, 7, 11, 10, 11, 7, 11, 10, 11, 15, 11, 15, 10, 12, 10, 14, 13, 11, 11, 12, 13, 10, 7, 13, 10, 16, 12, 21, 15, 9, 10, 10, 7, 11, 14, 17, 7, 7, 8, 11, 12, 8, 15, 14, 14, 8, 17, 12, 10, 10, 7, 9, 11, 7, 10, 7, 11, 18, 7, 11, 7, 12, 11, 8, 8, 14, 12, 7, 8, 15, 3, 7, 7, 5, 2, 9, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 2, 5, 3, 3, 3, 3, 3, 3, 4, 4, 3, 3, 3, 3, 3, 3, 5, 11, 6, 4, 7, 10, 7, 7, 11, 1, 10, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 5, 7, 3, 5, 6, 3, 3, 5, 2, 2, 5, 3, 4, 13, 11, 3, 3, 6, 3, 5, 14, 2, 2, 3, 8, 2, 2, 12, 5, 18, 5, 3, 3, 3, 16, 5, 5, 5, 10, 7, 13, 12, 13, 9, 12, 14, 19, 9, 9, 21, 9, 9, 10, 6, 9, 6, 15, 10, 6, 12, 8, 6, 10, 15, 4, 4, 6, 6, 9, 9, 12, 16, 14, 23, 7, 7, 7, 14, 9, 7, 7, 11, 14, 10, 7, 10, 10, 10, 12, 6, 11, 10, 13, 11, 15, 11, 7, 12, 10, 3, 7, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 3, 7, 1, 5, 2, 2, 2, 5, 5, 5, 5, 3, 3, 3, 3, 3, 5, 5, 10, 9, 11, 8, 7, 12, 8, 9, 7, 6, 13, 11, 6, 13, 7, 9, 9, 4, 4, 4, 4, 4, 6, 10, 7, 8, 13, 8, 8, 9, 14, 7, 8, 10, 7, 7, 7, 9, 6, 9, 7, 2, 12, 5, 3, 3, 13, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 8, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 9, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 2, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 1, 7, 6, 4, 12, 3, 3, 3, 3, 3, 8, 7, 3, 3, 3, 3, 3, 3, 4, 4, 11, 14, 2, 8, 3, 5, 5, 8, 10, 8, 6, 4, 7, 17, 7, 4, 5, 2, 6, 3, 2, 2, 12, 5, 5, 3, 15, 13, 8, 11, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 5, 3, 3, 3, 3, 4, 18, 2, 12, 5, 3, 3, 3, 3, 3, 5, 16, 8, 8, 9, 6, 6, 4, 4, 4, 4, 31, 6, 6, 10, 11, 21, 10, 9, 7, 10, 7, 7, 2, 4, 4, 4, 4, 6, 5, 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 6, 6, 2, 2, 2, 5, 3, 3, 3, 7, 7, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 8, 2, 3, 3, 3, 3, 3, 5, 9, 11, 3, 3, 3, 3, 4, 4, 3, 3, 3, 3, 3, 5, 10, 9, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 11, 10, 10, 10, 10, 10, 11, 10, 11, 10, 11, 10, 9, 9, 11, 3, 3, 3, 3, 3, 3, 5, 3, 7, 8, 8, 7, 6, 6, 11, 4, 4, 4, 7, 8, 9, 9, 2, 3, 7, 4, 4, 2, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 2, 2, 5, 5, 5, 5, 5, 3, 3, 5, 5, 5, 7, 7, 6, 6, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 8, 8, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 6, 9, 12, 3, 7, 10, 7, 2, 2, 3, 3, 3, 3, 3, 4, 3, 3, 2, 2, 2, 2, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 8, 8, 6, 6, 8, 6, 7, 4, 4, 4, 4, 4, 4, 6, 7, 5, 5, 20, 19, 8, 10, 9, 7, 10, 6, 8, 11, 6, 6, 6, 6, 13, 12, 8, 6, 7, 14, 11, 9, 2, 5, 3, 6, 2, 3, 2, 2, 2, 2, 2, 2, 2, 5, 4, 3, 7, 6, 4, 7, 4, 3, 6, 4, 7, 2, 7, 7, 7, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 9, 10, 10, 11, 7, 8, 20, 7, 8, 9, 8, 12, 6, 6, 6, 8, 9, 8, 12, 6, 6, 8, 13, 10, 12, 6, 6, 7, 7, 9, 6, 4, 4, 4, 4, 4, 4, 10, 6, 6, 6, 7, 14, 11, 10, 7, 8, 10, 8, 11, 14, 11, 11, 9, 7, 9, 8, 11, 9, 17, 10, 9, 2, 2, 2, 9, 3, 3, 3, 3, 15, 14, 9, 5, 5, 2, 8, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 15, 12, 22, 19, 17, 18, 18, 19, 21, 7, 16, 16, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 7, 16, 11, 11, 7, 7, 7, 7, 17, 7, 8, 12, 15, 9, 19, 7, 19, 8, 21, 11, 12, 19, 14, 22, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 16, 16, 19, 24, 12, 7, 14, 7, 12, 7, 8, 10, 10, 13, 7, 12, 12, 7, 7, 10, 18, 15, 12, 16, 7, 14, 12, 17, 10, 16, 17, 12, 17, 25, 7, 7, 7, 13, 6, 9, 6, 9, 18, 6, 6, 11, 20, 10, 6, 6, 6, 6, 6, 6, 17, 6, 6, 6, 15, 6, 6, 6, 6, 6, 8, 14, 11, 12, 11, 15, 13, 19, 17, 21, 7, 18, 8, 13, 13, 8, 12, 8, 6, 6, 13, 6, 15, 15, 16, 6, 6, 16, 6, 6, 6, 14, 6, 18, 6, 6, 6, 17, 18, 9, 13, 15, 8, 19, 8, 15, 15, 18, 14, 16, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 11, 10, 11, 6, 21, 23, 12, 17, 12, 11, 14, 13, 22, 15, 15, 11, 12, 14, 12, 7, 12, 8, 12, 14, 12, 18, 10, 8, 16, 19, 17, 12, 14, 15, 8, 19, 17, 12, 13, 13, 15, 18, 13, 23, 24, 23, 21, 17, 24, 8, 21, 8, 14, 14, 16, 20, 14, 8, 8, 15, 20, 8, 19, 21, 9, 8, 13, 12, 13, 15, 11, 8, 11, 9, 9, 8, 11, 8, 21, 14, 21, 15, 15, 13, 7, 19, 7, 7, 7, 7, 7, 7, 16, 12, 17, 18, 7, 7, 11, 11, 7, 9, 9, 2, 2, 3, 3, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 10, 10, 7, 9, 7, 7, 7, 6, 8, 6, 6, 6, 6, 6, 6, 6, 7, 6, 8, 6, 6, 9, 7, 7, 7, 4, 4, 4, 4, 4, 4, 4, 4, 8, 9, 8, 7, 8, 7, 8, 10, 7, 5, 5, 5, 5, 5, 5, 3, 9, 7, 7, 8, 6, 6, 6, 6, 6, 6, 6, 6, 9, 6, 6, 9, 11, 13, 7, 8, 9, 9, 5, 5, 5, 7, 8, 6, 6, 6, 6, 6, 6, 6, 7, 8, 9, 7, 10, 9, 10, 7, 8, 5, 5, 5, 5, 5, 5, 7, 7, 9, 8, 7, 7, 6, 6, 6, 6, 6, 6, 10, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 9, 10, 4, 4, 4, 4, 8, 7, 7, 10, 10, 9, 8, 8, 15, 9, 8, 8, 8, 8, 8, 9, 10, 9, 10, 7, 8, 13, 5, 5, 5, 5, 5, 3, 3, 7, 7, 8, 6, 6, 6, 4, 4, 11, 9, 7, 8, 9, 10, 7, 5, 5, 5, 5, 5, 3, 3, 7, 6, 6, 13, 7, 9, 8, 7, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 7, 8, 7, 8, 13, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 6, 6, 6, 6, 7, 6, 7, 6, 6, 9, 7, 4, 4, 4, 4, 4, 4, 4, 7, 8, 7, 8, 9, 8, 8, 8, 7, 10, 7, 8, 5, 5, 5, 5, 5, 5, 5, 5, 3, 7, 7, 7, 7, 9, 7, 10, 9, 6, 6, 6, 6, 6, 8, 8, 6, 6, 6, 7, 6, 6, 6, 9, 9, 4, 4, 13, 7, 10, 9, 9, 12, 7, 8, 8, 10, 8, 8, 8, 8, 8, 8, 5, 5, 5, 5, 3, 7, 7, 11, 7, 9, 8, 8, 6, 6, 10, 6, 8, 8, 8, 6, 7, 6, 6, 12, 4, 4, 4, 4, 4, 4, 4, 4, 4, 9, 8, 8, 16, 8, 9, 8, 7, 5, 5, 5, 5, 5, 3, 3, 7, 7, 7, 10, 15, 8, 9, 8, 9, 9, 6, 6, 6, 6, 6, 6, 7, 4, 8, 7, 8, 8, 7, 8, 11, 8, 5, 5, 5, 5, 5, 3, 7, 7, 6, 11, 16, 7, 6, 4, 4, 4, 4, 9, 9, 8, 8, 8, 13, 12, 8, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 11, 7, 8, 8, 9, 13, 7, 7, 7, 9, 8, 8, 9, 12, 7, 12, 7, 12, 8, 7, 10, 12, 9, 9, 6, 6, 8, 8, 6, 6, 6, 6, 6, 6, 6, 9, 8, 9, 11, 8, 6, 6, 6, 6, 6, 12, 7, 6, 6, 6, 9, 7, 7, 6, 6, 6, 6, 6, 11, 9, 6, 6, 6, 6, 6, 7, 9, 4, 4, 4, 4, 4, 4, 4, 4, 9, 9, 9, 9, 7, 7, 7, 7, 7, 11, 7, 7, 8, 8, 8, 8, 8, 8, 9, 8, 9, 9, 7, 7, 11, 11, 7, 12, 8, 8, 8, 8, 8, 7, 8, 8, 8, 8, 8, 13, 12, 8, 8, 8, 8, 7, 7, 7, 9, 5, 5, 5, 5, 5, 5, 5, 3, 3, 7, 7, 11, 7, 8, 8, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 10, 11, 6, 7, 9, 4, 4, 4, 4, 4, 4, 9, 9, 8, 9, 8, 8, 8, 7, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 11, 7, 7, 7, 9, 6, 6, 11, 8, 10, 6, 6, 6, 12, 8, 8, 7, 6, 6, 8, 7, 4, 4, 4, 4, 4, 4, 4, 4, 9, 10, 9, 9, 8, 10, 9, 11, 8, 5, 5, 5, 7, 6, 6, 8, 7, 4, 4, 4, 4, 8, 7, 7, 8, 7, 8, 8, 5, 5, 5, 5, 7, 7, 8, 8, 8, 6, 6, 6, 6, 6, 10, 8, 9, 13, 6, 7, 6, 6, 8, 7, 8, 4, 4, 4, 4, 11, 8, 8, 8, 10, 5, 5, 8, 7, 8, 13, 8, 7, 6, 8, 6, 9, 7, 8, 7, 5, 5, 5, 5, 5, 5, 3, 3, 7, 8, 9, 6, 4, 8, 10, 10, 8, 12, 9, 13, 2, 7, 5, 5, 5, 5, 5, 7, 7, 10, 6, 6, 6, 6, 6, 6, 6, 8, 4, 4, 9, 8, 8, 8, 14, 8, 8, 8, 9, 8, 5, 5, 5, 5, 5, 3, 3, 9, 6, 6, 6, 6, 10, 12, 6, 6, 6, 6, 6, 6, 6, 4, 4, 4, 4, 11, 8, 7, 8, 8, 8, 5, 5, 3, 3, 3, 3, 7, 7, 6, 8, 6, 8, 11, 7, 6, 6, 6, 7, 4, 8, 11, 9, 10, 5, 5, 5, 3, 3, 3, 7, 7, 8, 9, 8, 15, 9, 6, 6, 6, 6, 6, 6, 11, 11, 4, 4, 4, 4, 4, 7, 9, 9, 10, 8, 7, 5, 5, 5, 5, 5, 5, 3, 3, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 9, 7, 4, 4, 4, 4, 4, 9, 9, 8, 8, 10, 13, 5, 5, 5, 3, 17, 7, 7, 7, 7, 7, 8, 6, 8, 13, 6, 6, 6, 6, 6, 6, 6, 6, 4, 4, 4, 9, 10, 8, 8, 8, 5, 5, 5, 5, 3, 7, 7, 7, 8, 8, 6, 6, 6, 8, 8, 8, 9, 10, 8, 4, 8, 10, 9, 8, 8, 8, 9, 13, 10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 7, 8, 9, 9, 7, 7, 7, 10, 9, 9, 8, 9, 8, 8, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 8, 12, 6, 6, 6, 6, 6, 6, 6, 6, 6, 12, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 11, 8, 8, 9, 9, 10, 8, 9, 7, 7, 5, 5, 5, 5, 5, 5, 3, 7, 8, 7, 6, 6, 8, 6, 6, 10, 4, 7, 8, 9, 12, 8, 7, 7, 5, 5, 5, 5, 5, 5, 3, 3, 7, 14, 7, 9, 8, 8, 6, 6, 8, 12, 12, 6, 6, 7, 7, 10, 4, 4, 4, 4, 4, 9, 9, 14, 9, 13, 8, 7, 5, 5, 5, 6, 6, 6, 7, 4, 8, 7, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 7, 7, 7, 8, 6, 6, 6, 6, 6, 6, 12, 6, 6, 6, 6, 4, 4, 9, 9, 8, 8, 11, 7, 7, 7, 5, 5, 5, 3, 9, 8, 6, 6, 7, 4, 4, 4, 4, 4, 4, 8, 8, 11, 5, 5, 5, 7, 7, 7, 9, 6, 6, 6, 6, 6, 6, 9, 8, 4, 4, 4, 4, 7, 12, 9, 8, 8, 8, 7, 10, 10, 5, 5, 5, 5, 5, 5, 5, 3, 11, 14, 8, 7, 8, 8, 6, 6, 6, 6, 6, 8, 7, 6, 6, 6, 7, 6, 8, 9, 4, 4, 4, 7, 8, 9, 7, 9, 7, 7, 9, 8, 5, 5, 5, 5, 5, 5, 5, 5, 5, 11, 3, 9, 7, 7, 12, 14, 8, 6, 6, 12, 11, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 15, 7, 4, 4, 4, 16, 9, 9, 9, 8, 9, 9, 9, 9, 9, 8, 8, 8, 13, 11, 8, 5, 5, 5, 5, 3, 7, 6, 6, 8, 8, 8, 6, 6, 7, 10, 7, 4, 4, 4, 4, 9, 7, 8, 7, 7, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 7, 7, 7, 9, 6, 6, 6, 6, 6, 8, 8, 7, 7, 9, 6, 6, 6, 7, 6, 6, 6, 6, 6, 15, 4, 4, 4, 4, 4, 8, 8, 7, 8, 12, 9, 8, 8, 8, 8, 8, 9, 8, 8, 10, 8, 8, 8, 8, 16, 9, 10, 2, 5, 5, 5, 5, 5, 5, 5, 9, 7, 6, 8, 9, 4, 4, 4, 4, 4, 7, 8, 8, 8, 9, 8, 11, 10, 5, 5, 5, 5, 3, 7, 8, 6, 6, 6, 6, 6, 8, 6, 6, 6, 6, 4, 12, 10, 12, 7, 7, 7, 7, 7, 7, 7, 5, 5, 5, 5, 3, 3, 7, 7, 10, 8, 9, 7, 6, 10, 7, 6, 6, 4, 4, 8, 9, 7, 9, 9, 9, 9, 8, 8, 8, 8, 10, 5, 5, 5, 5, 5, 5, 8, 7, 6, 6, 6, 10, 6, 7, 10, 7, 4, 4, 4, 4, 4, 4, 4, 12, 9, 10, 7, 7, 10, 8, 10, 5, 12, 9, 6, 6, 6, 6, 6, 7, 6, 4, 4, 4, 10, 9, 9, 8, 7, 7, 5, 5, 5, 5, 5, 5, 3, 3, 13, 7, 7, 9, 7, 7, 7, 8, 9, 9, 7, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 13, 9, 15, 15, 4, 4, 4, 4, 4, 10, 10, 9, 8, 9, 8, 8, 9, 7, 8, 7, 8, 5, 5, 7, 6, 6, 6, 4, 4, 4, 7, 8, 11, 8, 5, 5, 5, 5, 5, 5, 5, 7, 6, 6, 6, 6, 6, 6, 9, 11, 10, 7, 4, 4, 4, 9, 8, 8, 5, 5, 5, 5, 5, 9, 9, 6, 6, 6, 6, 6, 6, 6, 9, 9, 4, 4, 4, 4, 8, 8, 8, 9, 9, 8, 8, 8, 13, 2, 4, 2, 7, 5, 5, 5, 5, 5, 5, 9, 9, 6, 6, 6, 6, 10, 8, 8, 8, 6, 6, 6, 4, 4, 9, 8, 10, 8, 9, 8, 8, 8, 9, 8, 8, 5, 3, 3, 3, 11, 6, 6, 6, 7, 6, 6, 6, 4, 4, 9, 8, 5, 5, 5, 5, 5, 3, 11, 8, 6, 6, 6, 6, 6, 9, 7, 4, 4, 14, 10, 9, 8, 12, 8, 8, 8, 11, 15, 8, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 11, 11, 11, 10, 10, 7, 7, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 7, 11, 7, 7, 11, 11, 7, 8, 9, 10, 7, 7, 9, 9, 9, 9, 7, 7, 10, 8, 13, 8, 8, 8, 8, 11, 10, 6, 6, 8, 10, 11, 14, 14, 6, 6, 6, 6, 6, 6, 9, 11, 7, 7, 6, 8, 12, 11, 11, 6, 6, 10, 6, 6, 6, 6, 6, 10, 7, 7, 6, 6, 11, 6, 6, 6, 11, 8, 9, 7, 6, 10, 11, 9, 10, 11, 7, 11, 8, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 8, 6, 6, 8, 9, 10, 9, 6, 6, 6, 10, 6, 6, 6, 6, 11, 10, 11, 10, 9, 8, 7, 7, 7, 7, 11, 14, 8, 10, 9, 9, 8, 8, 7, 11, 8, 8, 8, 11, 11, 10, 10, 9, 10, 8, 11, 10, 8, 11, 9, 12, 8, 10, 8, 11, 8, 9, 9, 11, 11, 10, 11, 13, 8, 7, 8, 8, 9, 7, 8, 8, 8, 8, 7, 8, 2, 2, 2, 2, 2, 2, 2, 4, 4, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 8, 6, 4, 4, 4, 11, 7, 11, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 5, 5, 5, 3, 3, 3, 3, 8, 7, 7, 8, 8, 4, 8, 7, 7, 7, 9, 7, 8, 9, 8, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 2, 3, 3, 3, 3, 3, 3, 4, 5, 5, 3, 3, 8, 8, 6, 9, 4, 4, 10, 7, 3, 3, 3, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 3, 2, 2, 2, 3, 3, 3, 3, 3, 4, 10, 2, 3, 3, 3, 3, 3, 3, 3, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 3, 3, 3, 5, 2, 4, 2, 6, 2, 2, 9, 5, 5, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 9, 8, 7, 9, 6, 6, 11, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 7, 7, 11, 8, 8, 6, 5, 11, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 2, 3, 3, 3, 3, 3, 3, 6, 4, 4, 4, 4, 3, 3, 3, 3, 5, 7, 2, 3, 3, 3, 3, 3, 8, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 4, 4, 4, 4, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 2, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 6, 3, 3, 8, 10, 3, 4, 4, 1, 1, 1, 1, 1, 1, 1, 8, 9, 10, 7, 7, 1, 14, 18, 13, 18, 13, 10, 10, 16, 13, 18, 16, 13, 16, 18, 13, 22, 16, 16, 16, 14, 21, 16, 9, 14, 16, 9, 9, 14, 10, 10, 14, 12, 14, 19, 12, 11, 18, 13, 17, 15, 15, 15, 15, 16, 14, 13, 19, 18, 15, 19, 18, 12, 18, 12, 11, 20, 14, 15, 10, 17, 17, 16, 19, 20, 21, 15, 13, 16, 15, 15, 15, 1, 1, 3, 8, 7, 7, 8, 8, 8, 1, 6, 1, 1, 6, 3, 3, 4, 7, 3, 3, 5, 5, 4, 4, 4, 4, 4, 2, 7, 7, 8, 12, 3, 4, 5, 1, 3, 4, 4, 10, 4, 3, 3, 3, 8, 7, 7, 2, 2, 2, 2, 2, 2, 2, 2, 2, 12, 9, 20, 7, 5, 5, 5, 9, 13, 5, 5, 5, 5, 5, 3, 3, 3, 16, 5, 5, 5, 13, 7, 8, 8, 11, 8, 7, 9, 7, 11, 12, 9, 9, 8, 8, 11, 10, 14, 7, 12, 10, 11, 13, 7, 9, 11, 17, 17, 14, 13, 7, 8, 7, 10, 10, 7, 16, 13, 7, 8, 17, 12, 9, 8, 6, 7, 10, 6, 6, 12, 6, 8, 10, 8, 8, 8, 6, 8, 6, 14, 6, 6, 6, 13, 6, 10, 6, 6, 7, 14, 8, 6, 6, 10, 11, 10, 9, 9, 7, 7, 6, 6, 6, 9, 9, 7, 9, 10, 9, 13, 12, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 6, 8, 8, 6, 8, 9, 10, 9, 7, 10, 10, 8, 7, 8, 7, 10, 12, 9, 8, 15, 8, 7, 8, 8, 7, 7, 15, 13, 7, 10, 9, 14, 18, 16, 7, 24, 7, 8, 10, 11, 16, 8, 14, 7, 9, 9, 9, 13, 19, 14, 15, 14, 11, 7, 13, 9, 10, 7, 13, 9, 10, 11, 12, 8, 9, 2, 3, 5, 8, 7, 4, 4, 15, 10, 5, 3, 3, 3, 3, 3, 5, 4, 4, 4, 2, 2, 2, 2, 2, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 12, 5, 3, 8, 10, 15, 6, 7, 2, 3, 2, 5, 5, 12, 2, 5, 5, 5, 5, 2, 2, 5, 5, 12, 9, 5, 2, 2, 9, 5, 5, 12, 12, 5, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 9, 12, 5, 8, 8, 9, 5, 5, 5, 8, 19, 7, 16, 15, 14, 9, 9, 9, 9, 7, 11, 11, 11, 7, 14, 10, 10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 15, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9, 9, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 14, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 15, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 12, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9, 9, 12, 9, 9, 12, 12, 12, 15, 7, 11, 7, 14, 11, 18, 13, 8, 18, 15, 18, 12, 14, 12, 8, 8, 8, 8, 9, 9, 9, 12, 7, 10, 10, 8, 8, 12, 12, 12, 7, 12, 12, 9, 7, 7, 7, 7, 7, 8, 15, 12, 9, 10, 10, 7, 10, 10, 13, 11, 10, 9, 22, 11, 9, 8, 8, 8, 8, 8, 13, 18, 13, 9, 15, 19, 9, 7, 7, 10, 7, 7, 7, 11, 8, 13, 17, 7, 7, 10, 10, 10, 7, 20, 16, 7, 7, 7, 7, 7, 7, 11, 21, 12, 12, 13, 11, 14, 16, 8, 8, 13, 11, 7, 7, 13, 7, 7, 14, 15, 15, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 13, 10, 18, 6, 6, 6, 6, 6, 6, 6, 6, 6, 11, 8, 8, 12, 12, 11, 11, 8, 12, 9, 9, 9, 13, 13, 9, 9, 9, 9, 9, 9, 6, 10, 12, 6, 6, 6, 6, 17, 11, 7, 7, 7, 7, 14, 14, 12, 6, 7, 7, 6, 6, 15, 10, 13, 10, 6, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 13, 9, 9, 15, 13, 6, 12, 12, 6, 19, 11, 10, 7, 7, 16, 8, 19, 17, 9, 9, 9, 9, 9, 6, 6, 6, 10, 8, 16, 8, 6, 6, 9, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 8, 6, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 14, 6, 6, 6, 6, 20, 6, 9, 6, 14, 9, 9, 9, 6, 9, 8, 8, 12, 9, 8, 8, 8, 8, 7, 8, 12, 7, 8, 8, 8, 6, 8, 6, 6, 6, 6, 6, 6, 6, 9, 8, 8, 6, 6, 13, 9, 12, 13, 12, 14, 13, 12, 11, 11, 6, 8, 8, 8, 6, 13, 12, 11, 11, 12, 6, 11, 12, 11, 13, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 15, 6, 6, 6, 6, 6, 6, 6, 13, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 8, 8, 6, 18, 6, 12, 13, 13, 13, 9, 10, 15, 9, 12, 6, 6, 6, 6, 6, 6, 6, 6, 9, 15, 10, 9, 10, 13, 9, 19, 8, 18, 17, 10, 10, 8, 8, 6, 6, 6, 6, 6, 6, 10, 14, 8, 16, 16, 9, 8, 15, 8, 8, 10, 12, 14, 7, 7, 8, 8, 7, 7, 7, 7, 8, 13, 13, 11, 9, 9, 9, 12, 10, 17, 8, 11, 9, 7, 7, 14, 8, 14, 14, 7, 7, 7, 7, 7, 7, 14, 7, 7, 7, 7, 7, 10, 10, 8, 14, 7, 7, 7, 7, 8, 8, 8, 8, 8, 17, 9, 7, 15, 7, 8, 12, 7, 9, 14, 7, 7, 7, 9, 13, 8, 14, 7, 16, 18, 13, 15, 14, 12, 13, 10, 15, 9, 7, 7, 7, 10, 13, 15, 15, 9, 9, 9, 9, 19, 11, 7, 11, 11, 13, 8, 8, 8, 8, 7, 12, 19, 17, 9, 9, 13, 7, 7, 7, 9, 7, 7, 7, 12, 13, 15, 10, 8, 8, 14, 15, 12, 13, 13, 8, 12, 14, 7, 11, 7, 14, 15, 13, 12, 8, 8, 8, 8, 11, 13, 15, 15, 8, 13, 12, 8, 8, 8, 13, 10, 16, 14, 11, 8, 8, 12, 12, 9, 15, 15, 12, 12, 13, 8, 8, 9, 12, 13, 9, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 11, 12, 11, 7, 14, 7, 13, 13, 13, 12, 18, 16, 7, 12, 11, 10, 10, 15, 9, 9, 9, 21, 7, 7, 7, 11, 16, 8, 8, 11, 11, 7, 7, 7, 7, 7, 19, 7, 7, 7, 7, 7, 7, 7, 7, 7, 12, 8, 9, 12, 14, 11, 9, 9, 9, 22, 12, 3, 3, 4, 8, 8, 15, 4, 2, 2, 5, 5, 3, 3, 3, 3, 3, 3, 6, 6, 4, 4, 4, 12, 7, 10, 2, 3, 3, 3, 3, 3, 3, 3, 6, 7, 3, 7, 5, 14, 4, 4, 7, 8, 10, 4, 1, 3, 3, 6, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 4, 2, 2, 5, 3, 4, 2, 2, 2, 2, 2, 2, 11, 5, 5, 5, 11, 5, 5, 3, 5, 5, 5, 5, 11, 14, 13, 9, 11, 9, 12, 8, 11, 11, 8, 11, 16, 9, 9, 7, 10, 9, 12, 8, 15, 6, 7, 6, 6, 13, 10, 8, 11, 8, 6, 6, 6, 12, 16, 6, 11, 7, 8, 9, 18, 6, 6, 9, 4, 4, 6, 13, 6, 6, 6, 6, 8, 8, 9, 16, 7, 7, 14, 7, 8, 8, 8, 7, 7, 7, 7, 7, 7, 15, 13, 7, 10, 7, 7, 10, 12, 16, 15, 7, 9, 9, 14, 11, 11, 10, 9, 10, 8, 12, 7, 8, 7, 7, 10, 12, 7, 12, 8, 7, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 3, 3, 5, 5, 5, 10, 4, 8, 7, 10, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 3, 3, 3, 3, 3, 3, 3, 7, 4, 5, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 6, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 9, 8, 2, 2, 2, 8, 12, 7, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 8, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 7, 11, 9, 8, 8, 8, 7, 8, 9, 7, 7, 9, 7, 7, 7, 10, 7, 7, 10, 9, 10, 6, 6, 6, 6, 6, 6, 15, 7, 8, 9, 9, 8, 6, 6, 10, 9, 6, 8, 13, 9, 7, 6, 6, 6, 6, 6, 6, 12, 6, 6, 7, 6, 7, 6, 6, 6, 10, 10, 7, 6, 6, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 14, 6, 6, 7, 7, 9, 6, 6, 6, 6, 9, 9, 8, 9, 10, 9, 8, 9, 12, 7, 7, 7, 8, 7, 10, 12, 11, 9, 10, 7, 7, 7, 9, 10, 10, 8, 12, 9, 7, 7, 9, 8, 8, 8, 10, 7, 7, 8, 9, 9, 7, 7, 7, 8, 2, 4, 6, 3, 4, 2, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 5, 8, 6, 4, 7, 3, 3, 3, 3, 3, 3, 3, 12, 3, 3, 3, 3, 3, 3, 4, 4, 2, 3, 5, 3, 4, 7, 3, 3, 3, 3, 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 4, 3, 3, 6, 4, 3, 4, 2, 2, 2, 5, 3, 3, 3, 3, 3, 5, 4, 4, 4, 4, 7, 6, 8, 9, 2, 2, 2, 2, 3, 3, 3, 5, 7, 2, 3, 3, 8, 7, 7, 2, 2, 8, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 8, 8, 7, 7, 6, 10, 6, 9, 7, 11, 4, 6, 8, 8, 7, 8, 4, 5, 5, 5, 5, 3, 3, 11, 8, 9, 6, 6, 8, 7, 4, 4, 7, 8, 7, 2, 2, 3, 3, 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 3, 7, 2, 2, 5, 3, 3, 2, 3, 3, 3, 3, 3, 3, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 12, 5, 5, 3, 3, 3, 5, 10, 12, 6, 15, 4, 6, 6, 7, 14, 9, 3, 3, 3, 3, 3, 8, 2, 2, 3, 5, 5, 3, 3, 3, 3, 3, 3, 8, 8, 8, 7, 5, 8, 4, 6, 11, 2, 2, 6, 7, 3, 3, 2, 9, 8, 5, 5, 3, 3, 3, 5, 5, 7, 7, 6, 6, 10, 6, 8, 6, 8, 9, 7, 4, 4, 4, 4, 7, 6, 6, 7, 7, 10, 9, 8, 11, 8, 3, 3, 3, 3, 3, 4, 4, 2, 3, 3, 3, 3, 3, 7, 6, 2, 5, 6, 7, 6, 4, 8, 9, 11, 2, 2, 3, 3, 3, 3, 3, 3, 3, 2, 2, 5, 3, 3, 3, 3, 3, 9, 9, 6, 4, 8, 7, 7, 5, 9, 8, 6, 2, 8, 7, 8, 5, 5, 5, 5, 5, 3, 3, 3, 16, 8, 7, 7, 7, 8, 7, 7, 7, 7, 9, 6, 9, 6, 10, 7, 7, 7, 6, 10, 8, 9, 11, 11, 8, 4, 4, 10, 8, 8, 6, 9, 6, 11, 8, 8, 8, 15, 7, 8, 9, 5, 3, 3, 3, 3, 3, 5, 11, 2, 2, 3, 8, 9, 10, 3, 2, 2, 2, 2, 2, 2, 3, 6, 4, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 2, 3, 3, 3, 3, 3, 3, 3, 11, 5, 3, 3, 3, 3, 3, 3, 3, 3, 6, 7, 4, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 12, 7, 4, 12, 4, 6, 5, 4, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 11, 10, 6, 4, 6, 10, 8, 3, 3, 3, 3, 3, 3, 3, 3, 5, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 5, 3, 4, 4, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 10, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 7, 8, 8, 7, 13, 12, 10, 10, 8, 8, 7, 7, 9, 12, 11, 6, 6, 8, 8, 9, 7, 7, 7, 10, 15, 10, 4, 4, 4, 4, 4, 11, 8, 8, 9, 7, 9, 14, 14, 12, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 12, 5, 5, 5, 11, 10, 7, 9, 3, 8, 7, 3, 15, 13, 11, 4, 4, 2, 2, 2, 19, 7, 5, 5, 3, 3, 3, 3, 3, 3, 3, 5, 22, 18, 6, 14, 17, 4, 4, 19, 16, 18, 2, 3, 3, 7, 2, 3, 2, 3, 3, 6, 4, 2, 3, 3, 2, 5, 3, 3, 3, 3, 3, 3, 3, 9, 9, 2, 3, 2, 2, 2, 3, 3, 3, 5, 7, 14, 7, 7, 12, 9, 13, 6, 11, 6, 10, 9, 7, 7, 8, 12, 12, 8, 8, 8, 10, 7, 7, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 5, 8, 10, 7, 8, 11, 8, 12, 9, 4, 14, 7, 7, 9, 13, 2, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 1, 2, 2, 3, 3, 3, 3, 3, 3, 5, 2, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 8, 4, 4, 4, 3, 2, 3, 3, 3, 3, 5, 2, 2, 2, 2, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 12, 9, 8, 8, 9, 8, 6, 17, 6, 6, 6, 8, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 4, 4, 8, 8, 9, 9, 9, 7, 7, 7, 7, 7, 7, 7, 9, 9, 9, 7, 8, 8, 8, 10, 7, 13, 10, 8, 9, 3, 3, 5, 13, 3, 3, 3, 3, 3, 7, 7, 6, 6, 10, 13, 11, 11, 8, 8, 9, 8, 9, 9, 10, 10, 10, 11, 10, 10, 13, 13, 16, 15, 11, 12, 9, 9, 10, 9, 11, 10, 9, 9, 14, 7, 8, 3, 10, 7, 7, 3, 2, 2, 2, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 6, 7, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 11, 6, 7, 4, 6, 2, 2, 3, 3, 3, 1, 3, 3, 3, 3, 3, 3, 6, 4, 4, 2, 2, 2, 3, 3, 3, 3, 4, 4, 6, 6, 6, 6, 5, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 9, 11, 6, 10, 9, 12, 7, 7, 11, 14, 9, 7, 12, 3, 3, 7, 12, 11, 12, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 11, 5, 5, 5, 5, 5, 5, 5, 5, 11, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 10, 3, 3, 3, 11, 3, 5, 9, 11, 8, 12, 14, 9, 7, 8, 7, 7, 11, 11, 7, 7, 10, 9, 8, 10, 9, 7, 7, 7, 7, 7, 7, 8, 8, 7, 11, 8, 8, 8, 7, 7, 10, 8, 7, 13, 12, 7, 17, 10, 8, 8, 11, 7, 11, 11, 14, 7, 11, 7, 8, 6, 9, 20, 8, 7, 9, 16, 7, 10, 6, 11, 10, 8, 9, 7, 16, 11, 11, 9, 8, 9, 8, 8, 8, 11, 8, 15, 8, 8, 9, 7, 8, 8, 11, 10, 7, 5, 7, 10, 10, 15, 7, 7, 7, 8, 7, 8, 8, 10, 11, 10, 10, 10, 11, 11, 7, 8, 6, 8, 8, 8, 10, 6, 8, 6, 6, 7, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 16, 6, 15, 6, 7, 11, 11, 7, 9, 10, 11, 13, 10, 6, 16, 8, 10, 12, 11, 6, 6, 6, 6, 6, 6, 6, 10, 6, 10, 7, 7, 7, 11, 7, 11, 6, 6, 6, 6, 6, 6, 17, 7, 7, 6, 6, 12, 22, 6, 6, 6, 6, 6, 8, 6, 6, 6, 6, 7, 6, 6, 5, 6, 6, 8, 11, 6, 9, 14, 11, 9, 11, 7, 7, 8, 6, 6, 6, 8, 10, 9, 6, 6, 6, 6, 9, 7, 6, 6, 6, 6, 6, 15, 6, 4, 4, 4, 6, 4, 17, 8, 11, 6, 6, 9, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 6, 6, 6, 6, 10, 6, 10, 6, 6, 6, 6, 12, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 9, 6, 6, 6, 6, 18, 6, 6, 6, 8, 9, 10, 7, 8, 9, 10, 11, 7, 13, 6, 8, 8, 6, 6, 14, 7, 7, 7, 7, 10, 7, 14, 9, 6, 6, 9, 15, 9, 7, 14, 6, 11, 14, 13, 7, 12, 8, 7, 7, 7, 7, 7, 12, 7, 10, 9, 16, 6, 8, 6, 5, 17, 6, 8, 10, 4, 6, 4, 10, 15, 17, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 8, 4, 4, 11, 7, 4, 4, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 19, 17, 6, 10, 11, 6, 6, 6, 6, 18, 6, 6, 11, 4, 4, 4, 5, 6, 6, 6, 9, 5, 6, 4, 6, 6, 4, 6, 6, 6, 6, 10, 6, 6, 4, 6, 6, 10, 6, 10, 6, 6, 6, 6, 11, 6, 6, 10, 6, 6, 8, 6, 6, 6, 8, 6, 11, 4, 11, 9, 10, 9, 11, 4, 8, 4, 11, 12, 7, 9, 8, 6, 7, 7, 8, 12, 12, 11, 13, 10, 11, 7, 7, 7, 9, 7, 11, 10, 7, 7, 7, 16, 11, 10, 11, 17, 9, 9, 8, 8, 7, 7, 7, 9, 7, 7, 7, 14, 7, 13, 9, 11, 10, 14, 10, 10, 12, 11, 10, 7, 10, 5, 14, 8, 8, 8, 9, 7, 8, 7, 7, 9, 8, 7, 8, 7, 7, 7, 7, 7, 7, 7, 11, 8, 10, 8, 7, 8, 14, 11, 8, 9, 9, 9, 8, 24, 10, 10, 12, 7, 7, 15, 11, 8, 8, 12, 11, 8, 9, 9, 7, 8, 9, 10, 11, 10, 11, 7, 12, 7, 7, 11, 9, 8, 14, 13, 12, 8, 11, 10, 8, 8, 7, 7, 14, 9, 10, 8, 9, 11, 7, 14, 8, 8, 13, 8, 8, 12, 7, 10, 14, 14, 11, 9, 10, 9, 9, 7, 7, 11, 11, 13, 9, 13, 5, 5, 5, 7, 9, 5, 11, 12, 14, 8, 7, 7, 11, 10, 9, 7, 8, 8, 7, 10, 11, 11, 5, 5, 7, 5, 5, 5, 7, 7, 15, 7, 7, 8, 7, 15, 12, 12, 10, 7, 8, 7, 11, 7, 7, 7, 23, 11, 8, 8, 11, 10, 7, 8, 11, 7, 19, 7, 7, 6, 9, 9, 9, 11, 3, 4, 7, 8, 6, 6, 4, 10, 8, 2, 2]);
const edgeChild = /* @__PURE__ */ new Uint16Array([0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 12, 1, 1, 1, 1, 1, 17, 1, 1, 1, 12, 1, 12, 1, 12, 13, 1, 1, 1, 1, 12, 1, 12, 1, 1, 1, 1, 1, 14, 21, 1, 1, 1, 1, 1, 1, 1, 19, 12, 1, 1, 1, 1, 1, 1, 1, 1, 20, 1, 1, 1, 16, 18, 1, 1, 15, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 22, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 1, 24, 25, 26, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 12, 12, 12, 12, 1, 32, 0, 0, 0, 1, 1, 1, 1, 35, 34, 1, 1, 1, 1, 1, 33, 1, 1, 1, 1, 37, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 38, 0, 0, 0, 0, 39, 40, 0, 0, 0, 0, 12, 1, 1, 12, 1, 1, 1, 1, 43, 44, 44, 44, 43, 44, 43, 43, 45, 44, 43, 44, 43, 43, 43, 43, 43, 43, 45, 43, 43, 43, 43, 43, 43, 44, 46, 46, 44, 43, 43, 43, 43, 43, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 49, 51, 49, 49, 49, 51, 49, 50, 49, 52, 49, 50, 50, 49, 49, 49, 50, 52, 50, 52, 49, 50, 50, 12, 54, 54, 53, 55, 50, 52, 49, 49, 47, 48, 56, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 59, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 66, 67, 12, 1, 1, 65, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 78, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 76, 79, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 77, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 12, 1, 1, 1, 1, 89, 1, 91, 1, 1, 1, 1, 1, 1, 1, 1, 94, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 97, 97, 1, 1, 12, 1, 100, 1, 1, 1, 1, 1, 1, 1, 98, 1, 99, 1, 101, 1, 1, 1, 1, 1, 102, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 110, 111, 1, 1, 1, 1, 1, 1, 113, 113, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 121, 122, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 122, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 122, 1, 1, 1, 1, 1, 1, 1, 1, 1, 126, 123, 125, 120, 1, 124, 1, 1, 114, 1, 1, 1, 1, 117, 1, 127, 1, 1, 1, 1, 1, 1, 119, 1, 108, 1, 109, 1, 12, 128, 106, 1, 112, 1, 1, 1, 1, 1, 107, 115, 1, 12, 12, 12, 118, 116, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 12, 12, 1, 1, 1, 1, 1, 12, 134, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 136, 1, 1, 1, 1, 1, 1, 1, 1, 137, 138, 12, 12, 135, 133, 44, 44, 140, 49, 49, 139, 142, 141, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 143, 0, 0, 0, 0, 1, 0, 144, 132, 1, 0, 1, 1, 12, 12, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 148, 147, 20, 1, 1, 12, 12, 1, 20, 12, 12, 1, 1, 1, 1, 1, 134, 1, 1, 152, 1, 1, 1, 1, 153, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 1, 1, 136, 1, 1, 152, 1, 1, 1, 1, 153, 1, 1, 134, 1, 1, 1, 152, 1, 1, 1, 1, 153, 1, 1, 134, 1, 1, 1, 1, 1, 1, 1, 1, 134, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 160, 1, 1, 1, 152, 1, 1, 1, 1, 1, 153, 1, 1, 160, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 134, 1, 1, 1, 1, 152, 1, 1, 1, 1, 153, 1, 1, 1, 134, 1, 1, 152, 1, 1, 1, 1, 164, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 1, 167, 1, 1, 160, 1, 1, 1, 1, 1, 152, 1, 1, 1, 1, 1, 153, 1, 1, 160, 1, 1, 1, 1, 1, 152, 1, 1, 1, 1, 1, 153, 1, 154, 158, 158, 12, 1, 12, 166, 1, 1, 1, 1, 1, 158, 158, 158, 154, 1, 1, 1, 157, 158, 161, 165, 1, 1, 1, 1, 157, 157, 1, 1, 156, 154, 154, 157, 170, 156, 170, 1, 1, 168, 1, 156, 155, 157, 1, 1, 1, 1, 157, 1, 159, 1, 1, 1, 12, 1, 162, 1, 162, 1, 1, 1, 162, 161, 163, 169, 156, 154, 1, 1, 1, 1, 1, 1, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 172, 173, 172, 172, 173, 172, 172, 172, 172, 174, 174, 172, 172, 173, 172, 173, 172, 172, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 176, 12, 1, 12, 12, 12, 12, 1, 12, 12, 12, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 198, 1, 1, 1, 1, 12, 204, 205, 206, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 151, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 201, 1, 1, 1, 188, 1, 1, 1, 1, 212, 1, 1, 209, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 179, 195, 1, 1, 1, 191, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 186, 1, 1, 1, 1, 1, 1, 1, 196, 1, 1, 1, 1, 200, 1, 1, 1, 1, 171, 1, 1, 194, 1, 1, 1, 197, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 184, 1, 12, 1, 1, 12, 1, 1, 1, 1, 187, 1, 1, 1, 193, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 213, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 199, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 178, 12, 1, 1, 1, 181, 12, 1, 1, 1, 1, 1, 1, 1, 203, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 180, 1, 1, 1, 1, 1, 1, 1, 208, 1, 1, 1, 185, 1, 1, 1, 192, 1, 12, 1, 189, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 196, 1, 1, 1, 1, 183, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 175, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 190, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 210, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 211, 1, 1, 12, 1, 1, 1, 1, 182, 1, 1, 1, 190, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 202, 1, 1, 1, 1, 177, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 207, 1, 1, 12, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 223, 0, 0, 0, 0, 0, 224, 0, 0, 0, 0, 0, 0, 1, 12, 1, 1, 1, 228, 1, 1, 1, 0, 229, 226, 227, 1, 1, 1, 1, 1, 1, 234, 1, 236, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 232, 1, 1, 1, 1, 1, 238, 1, 1, 12, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 237, 1, 1, 1, 12, 1, 1, 1, 1, 233, 1, 1, 1, 231, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 235, 1, 1, 1, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 1, 12, 1, 1, 1, 12, 1, 1, 244, 13, 1, 1, 1, 12, 12, 241, 242, 1, 1, 1, 1, 243, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 245, 1, 1, 12, 16, 1, 1, 1, 1, 1, 1, 246, 1, 1, 1, 12, 12, 1, 1, 1, 1, 1, 1, 246, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 259, 259, 1, 0, 0, 0, 0, 0, 1, 12, 0, 0, 0, 0, 0, 0, 0, 0, 172, 264, 265, 1, 12, 1, 1, 1, 1, 12, 267, 1, 1, 266, 1, 1, 269, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 273, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 12, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 12, 0, 284, 0, 0, 285, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 59, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 309, 0, 0, 0, 0, 0, 0, 0, 0, 0, 311, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 327, 327, 328, 327, 0, 190, 1, 1, 13, 323, 1, 321, 0, 0, 0, 0, 0, 0, 0, 324, 1, 1, 329, 1, 209, 1, 1, 1, 1, 322, 1, 319, 1, 325, 1, 317, 1, 326, 1, 318, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 12, 320, 320, 1, 1, 1, 188, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 12, 1, 1, 1, 1, 316, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 332, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 269, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 372, 372, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 364, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 340, 351, 1, 1, 339, 374, 1, 345, 1, 1, 337, 369, 1, 1, 355, 336, 341, 1, 1, 1, 348, 379, 357, 1, 1, 1, 1, 1, 1, 358, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 367, 371, 0, 0, 79, 1, 1, 0, 365, 342, 378, 343, 346, 353, 1, 368, 0, 1, 0, 79, 362, 360, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 381, 1, 1, 352, 1, 79, 1, 0, 1, 1, 1, 384, 1, 0, 0, 79, 359, 0, 1, 338, 1, 1, 1, 0, 1, 1, 361, 1, 0, 1, 1, 1, 0, 1, 386, 349, 1, 1, 0, 1, 0, 0, 377, 0, 1, 1, 1, 79, 370, 1, 1, 366, 363, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 344, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 376, 0, 79, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 380, 1, 1, 1, 0, 0, 383, 0, 0, 0, 1, 356, 1, 0, 79, 382, 1, 0, 0, 0, 0, 385, 1, 1, 0, 0, 1, 0, 1, 0, 354, 0, 350, 0, 1, 1, 1, 0, 1, 1, 0, 373, 347, 375, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 12, 1, 1, 1, 12, 401, 401, 1, 1, 12, 12, 1, 401, 1, 1, 12, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 413, 1, 1, 0, 1, 1, 1, 1, 209, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 431, 431, 1, 1, 0, 0, 317, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 444, 1, 443, 1, 1, 1, 1, 1, 1, 1, 1, 1, 448, 1, 12, 12, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 456, 1, 1, 1, 458, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 455, 1, 450, 1, 1, 1, 1, 437, 1, 1, 1, 1, 1, 1, 1, 1, 451, 12, 1, 1, 1, 1, 457, 1, 1, 1, 452, 446, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 317, 1, 434, 1, 1, 12, 454, 1, 1, 317, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 439, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 457, 1, 1, 1, 1, 317, 1, 453, 1, 1, 1, 447, 441, 1, 1, 1, 1, 1, 442, 1, 459, 445, 1, 1, 1, 1, 1, 440, 1, 1, 1, 1, 1, 1, 1, 1, 1, 435, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 449, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 438, 1, 1, 1, 1, 1, 436, 1, 223, 460, 1, 1, 1, 1, 1, 12, 1, 1, 1, 1, 12, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 0, 466, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 12, 1, 67, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 470, 0, 470, 470, 470, 470, 470, 470, 470, 0, 470, 470, 470, 470, 470, 1, 470, 470, 470, 0, 470, 470, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 475, 474, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 479, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 472, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 473, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 481, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 470, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 478, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 471, 0, 0, 482, 477, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 476, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 470, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 471, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 470, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 480, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 492, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 203, 203, 1, 496, 1, 1, 1, 495, 1, 1, 1, 1, 491, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 493, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 497, 1, 1, 494, 1, 1, 1, 1, 1, 1, 1, 1, 372, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 498, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 509, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 12, 1, 511, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 12, 12, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 59, 1, 1, 12, 12, 12, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 530, 1, 1, 1, 1, 1, 1, 1, 531, 1, 1, 1, 1, 1, 1, 1, 529, 1, 1, 12, 1, 1, 533, 242, 1, 1, 12, 12, 1, 1, 12, 1, 12, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 537, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 543, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 132, 1, 12, 548, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 107, 1, 1, 12, 1, 1, 1, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 553, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 144, 1, 1, 1, 231, 1, 1, 12, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 578, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 223, 1, 328, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 583, 1, 1, 1, 1, 0, 585, 0, 79, 0, 584, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 12, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 592, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 587, 587, 0, 591, 589, 587, 587, 587, 587, 587, 593, 587, 587, 597, 587, 587, 587, 587, 587, 587, 587, 587, 587, 587, 594, 591, 587, 587, 591, 587, 587, 587, 587, 587, 587, 587, 587, 587, 587, 587, 587, 587, 589, 587, 587, 587, 587, 587, 595, 587, 587, 587, 587, 587, 587, 0, 0, 0, 1, 596, 1, 1, 1, 1, 590, 1, 1, 1, 1, 1, 588, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 12, 601, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 12, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 12, 1, 1, 12, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 96, 64, 281, 307, 412, 539, 0, 4, 68, 239, 257, 283, 308, 334, 388, 414, 0, 503, 523, 540, 603, 9, 0, 60, 88, 398, 410, 430, 581, 0, 501, 522, 536, 618, 0, 30, 6, 0, 465, 504, 608, 566, 70, 0, 7, 286, 258, 389, 467, 417, 542, 79, 604, 0, 582, 310, 419, 469, 9, 105, 289, 510, 6, 30, 0, 312, 79, 391, 79, 487, 10, 6, 131, 251, 276, 0, 619, 513, 0, 569, 0, 63, 6, 6, 254, 95, 2, 433, 399, 411, 602, 0, 6, 0, 6, 287, 103, 6, 567, 505, 544, 0, 468, 390, 274, 288, 8, 71, 104, 605, 547, 392, 313, 301, 420, 146, 74, 291, 551, 514, 607, 570, 335, 330, 483, 6, 75, 149, 11, 0, 252, 526, 552, 571, 518, 556, 576, 617, 36, 6, 263, 296, 333, 305, 221, 30, 532, 559, 221, 41, 219, 268, 297, 306, 407, 424, 485, 275, 0, 73, 568, 0, 404, 418, 300, 79, 250, 79, 0, 586, 550, 508, 293, 422, 79, 393, 387, 0, 0, 0, 9, 561, 577, 220, 0, 425, 408, 535, 520, 579, 621, 85, 221, 42, 298, 396, 426, 575, 0, 515, 294, 277, 79, 218, 80, 28, 390, 30, 6, 394, 331, 304, 610, 598, 528, 555, 517, 0, 261, 81, 30, 406, 423, 0, 30, 427, 0, 222, 599, 521, 9, 409, 428, 221, 251, 86, 225, 600, 580, 563, 486, 429, 397, 253, 230, 87, 58, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 626, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 415, 0, 0, 0, 0, 0, 0, 0, 0, 82, 0, 129, 0, 0, 84, 554, 0, 0, 0, 0, 0, 0, 0, 27, 0, 557, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 415, 0, 0, 0, 0, 507, 0, 260, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 295, 0, 0, 0, 0, 0, 0, 0, 623, 0, 0, 0, 0, 0, 622, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 395, 0, 0, 0, 488, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 69, 0, 0, 0, 0, 0, 0, 499, 0, 0, 0, 0, 0, 0, 405, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 214, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 519, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 272, 282, 0, 0, 0, 0, 0, 534, 278, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 516, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 461, 0, 0, 0, 315, 0, 0, 0, 0, 0, 0, 256, 0, 0, 0, 0, 0, 0, 23, 0, 0, 0, 0, 574, 0, 0, 0, 0, 606, 525, 0, 0, 0, 0, 247, 0, 0, 0, 0, 0, 0, 463, 0, 0, 484, 0, 0, 0, 0, 0, 61, 0, 0, 0, 270, 57, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 249, 0, 0, 0, 0, 0, 280, 616, 0, 72, 0, 0, 0, 0, 0, 0, 0, 0, 0, 625, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 150, 0, 279, 0, 0, 0, 0, 0, 0, 573, 0, 0, 0, 0, 0, 0, 527, 0, 0, 0, 0, 0, 0, 0, 0, 0, 572, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 62, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 216, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 84, 0, 506, 0, 0, 0, 0, 0, 560, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 84, 83, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 490, 0, 489, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 262, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 462, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 290, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 541, 0, 0, 0, 0, 0, 0, 0, 0, 299, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 69, 240, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 84, 0, 612, 0, 0, 558, 0, 0, 0, 0, 0, 0, 0, 0, 0, 248, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 615, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 524, 0, 0, 0, 84, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 502, 0, 620, 0, 0, 432, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 403, 0, 0, 0, 549, 0, 93, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 31, 0, 0, 0, 0, 0, 0, 29, 92, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 292, 0, 0, 0, 217, 0, 0, 0, 0, 0, 0, 564, 0, 0, 0, 0, 130, 0, 0, 0, 0, 0, 565, 0, 0, 0, 0, 0, 0, 0, 415, 421, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 400, 0, 314, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 302, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 538, 0, 0, 0, 416, 0, 0, 402, 0, 0, 0, 0, 0, 0, 609, 0, 0, 0, 545, 0, 0, 90, 0, 546, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 512, 464, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 271, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 415, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 614, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 613, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 624, 0, 0, 0, 0, 0, 562, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 303, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 611, 0, 0, 215, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 629, 629, 629, 629, 629, 629, 629, 628, 630]);
const labelText = "orgmilcomschnetedugovdrrformsfeedbackofficialaccoorgmilschnetgovmagazinemediaunioncargopilotgroupcaarespressworksaerodromeworkinggroupair-traffic-controlaircraftaccident-preventioneducatormarketplaceambulanceinsurancecateringairportrepbodyenginesoftwaremodellingair-surveillanceconsultingchartertrainermaintenanceservicesdesignflightskydivingfreightassociationstudentgroundhandlingdgcafuelclubtaxicrewshowballooningexpresstraderbrokerauthoragentsairtrafficjournalistsafetyconsultantmicrolightaccident-investigationparachutingequipmentproductionfederationrecreationscientistnavigationengineertradingglidingleasingresearchpassenger-associationentertainmentparaglidinghangglidingaerobaticrotorcraftemergencycertificationgovernmentaeroclubexchangelogisticschampionshiphomebuiltcouncilconferencecontrolairlinecivilaviationjournalorgcomnetedugovcoorgcomnomnetobjofforgcomnetuwukiloappsframerorgmilcomnetedugovcoradioorgcomnetcommuneedogpbcoitgvorgedugov*spreviewfrontendrelayononstagingupid*mtls*privatelinktypedreamdeveloperbravemochawindsurfaivenmirenupsunwnextbegetngrokclerkwale2bwebcsbrunputerflutterflowspawnbaseshiptodaymagicpatternsnetlifyondigitaloceanrailwayhostedclaudehasurabotdashretoolvercelgithubluyanigadgetreplitcloudflaretelebitedgecomputeevervaultexponyatnoopencrpplxzeaburwasmerframerzeropsrocketpreviewconvexmedusajsspritesonherculeseasypanelstreamlitglideossnowflakemesserliloginlinehackclubcodepennorthflankbase44corespeedleapcellngrok-freeclerkstagelovableon-fleek*us-west-3ap-south-2us-central-2us-central-1eu-central-1ap-south-1us-west-2us-east-2eu-north-1ap-north-1us-west-1us-east-1*rcloudintsegorgmilcomgobbetnetintedugovturmusicasenasamutualcoopip6uriurnin-addre164homeirisgovdixdaemoncloudnssthwien*inexexkunden4accogvormymyspreadshop4lima2ixortsinfofuturecmsfuturehosting12hpprivfuturemailinglima-cityfunkfeuer123webseitednshomemelmyspreadshopcloudletswasantqldvicactnswtascatholicwasaqldvictasidwasantozqldorgcomvicasnactnetedugovnswtasconfcomairflowlambda-urltransfer-webappairflowtransfer-webapptransfer-webapptransfer-webapp-fipstransfer-webappeu-west-3ap-south-2eu-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1mx-central-1me-central-1ca-central-1il-central-1ap-northeast-1ap-southeast-1me-south-1af-south-1eu-south-1ap-south-1ap-southeast-7us-west-2eu-west-2us-east-2eu-north-1ap-southeast-2ap-northeast-2ap-southeast-5us-gov-west-1us-gov-east-1ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1privatenotebookstudiolabelingnotebookstudionotebooknotebook-fipslabelingnotebookstudionotebook-fipsnotebookstudio-fipsnotebook-fipsnotebookstudionotebook-fipsnotebookstudioeu-west-3ap-south-2eu-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1me-central-1ca-central-1il-central-1ap-northeast-1ap-southeast-1me-south-1af-south-1eu-south-1ap-south-1us-west-2eu-west-2us-east-2eu-north-1ap-southeast-2ap-northeast-2experimentsus-gov-west-1us-gov-east-1ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1onrepostsagemakercopporgmilcompronetintedugovbiznameinfoshoprsorgmilcomnetedugovbrendlyresolvenzauscotvstoreorgcomnetedugovbizinfoidacaicoittvorgmilcomschnetedugovinfocloudezproxysiteacmymyspreadshopkuleuvenwebhostingtransurl123websitecloudnsinterhostsolutionsddns5476103298edgfacbmlonihkjutwvqpsryxzbarsycoororgcomedumyftpno-iporxcloud-ipfor-somemmafanfor-morewebhopselfipjozidyndnscloudnsdscloudfor-thefor-betteractivetrailcoeconorestooteorgcomeconeteduassurmoneyafricaarchitectesrestaurantloisirstourismavocatsinfoagrounivcoorgcomnetedugoviatvdeportesaludtksatorgmilcomwebgobnetinteducienciaboliviarevistacooperativaempresanombreindustriamusicapatriamedicinademocraciapoliticapuebloindigenaplurinacionalarteblogwikiinfoagrotransportenoticiasprofesionalacademiaeconomiaecologiamovimientotecnologianaturalsimplesitecepesebamapadfmgalampbacscpirngorotomtrjspaprrprrsesmscepesebamapadfmgalampbacscpirngorotomtrjspaprrprrsesms*biaamfmtcmptvfeirasampajampanatalbelemananiradiog12medindfndbmdtrdthepoaggfjdfdefinfenflegsegongengcngorgzlgslglogppgmillelqslcimcomnomadmjabimbbibbsbabcrectecsjcetcpscpvhudieticriapipsiecnbiorioecogeoteoodoproatoartfstmatvetdetbetnetcntnotfotgrueduajuespappreptmpemparqsrvadvdevgovntrturagrjorfarjusmusdesvixxyzcozfozslzbhzmaringasantamariacampinagrandegoianiasorocabafloripasaobernardocuritibaboavistarecifeaparecidasaogoncasalvadorcuiabamorenamacapalondrinacontagemsocialfortalmaceioleilaoosascoriobranconiteroi9guacutcheblogflogvlogwikitaxicoopmanauspalmascaxiasjoinvillebaruericampinassantoandreribeiraoriopretoweorgcomnetedugovv0windsurfshiptodaycloudsitecoaccoorgnetgovofmilcomgovmediatechzacoorgcomnetedugsjgovmydnspenfnlabnbmbgcbcqconcontnuyksknsmyspreadshopno-ipawdevboxbarsyonidatemfuinabusavinstanceseceuguukussryzespawncsxcloud-ipmyphotosfantasyleaguetwmailcleverappsscrappingccwucloudnsftpaccessgame-serverccgovobjectsrmalpgcust*svcalp1aeappenginermalpgmyspreadshop4lima2ixsquare7cloudscale123websitefirenet12hpflowgotdnslinkyard-cloudcloudnslima-citydnskingobjectstorageedaccogoorusorgcomnetinteduaéroportxn--aroport-byaassogouvcomilgobgovcloudnses-1eu-west-1us-east-1euvipit1eurarubait1s3lbwebsites3websiteru-spbru-mskelasticcsrunstnukukcaukusnl-ams-1fr-par-1fr-par-2functionsnodess3ddlwhmrdbfnck8sifrs3-websitecockpitscblmgdbdtwhkafkpubprivs3ddlwhmrdbk8sifrs3-websitecockpitscblmgdbdtwhkafks3ddlrdbk8sifrs3-websitecockpitscblmgdbdtwhkafkk8sscalebookpl-wawfr-parnl-amsbaremetalsmartlabelinginstancesdechk2kuleuvenlaravelvoorloperurownoxazapscwhstgrvaporonline-serverobservablehqelementorantagonistreclaimjoteluluencowaydiademjelasticmatlabmagentositetrendhostingaxarnetperspectajenv-arubajelejoteravendbemergenttrafficplexconvexkeliwebserveboltbegetcdnstaticson-rancherprimetelonstackitunison-servicesdnshomelinkyardbarsyjelecloudnscocomnetgovmycn-northwest-1cn-north-1s3s3-accesspoints3-websites3s3-accesspointrdsdualstacks3-deprecatedemrappui-prods3-websiteemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apis3s3-accesspoints3s3-accesspointrdsdualstackemrappui-prods3-websiteemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicn-northwest-1cn-north-1cn-northwest-1ebcomputeelbcn-north-1airflowcn-northwest-1cn-north-1oncn-northwest-1cn-north-1amazonawssagemakeramazonwebservicesdirectasgdsdhehahljlnmhbacscahqhshhihnlnynsnmofjbjzjxjtjhkcqtwgsjssxnxjxgxxzgz網絡网络公司orgmilcomnetedugovxn--55qx5dcanva-appsxn--io0a7iquickconnectcanvasitekhsjxn--od0algcanva-codemyqnapcloudsrvrlessclustersrealtimestorageleadpagescarrdcrdorgmilcomnomnetedugovhidnssupabaserdpareplmypiumsoxmitotaplpagesfirewalledreplitowodevwebview-assetsvfswebview-assetss3s3-accesspointdualstackemrappui-prods3-websiteaws-cloud9emrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9eu-west-3ap-south-2eu-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1me-central-1ca-central-1il-central-1ap-northeast-1ap-southeast-1me-south-1af-south-1eu-south-1ap-south-1ap-southeast-7us-west-2eu-west-2us-east-2eu-north-1ap-southeast-2ap-northeast-2ap-southeast-5ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1s3s3-accesspointdualstackemrappui-prods3-websiteaws-cloud9emrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9s3s3-accesspointdualstackanalytics-gatewayemrappui-prods3-websiteaws-cloud9emrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9s3s3-accesspointdualstackemrappui-prods3-websiteemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apis3s3-accesspointdualstacks3-deprecateds3-websites3-object-lambdaexecute-apis3s3-accesspoints3-websites3-accesspoint-fipss3-fipss3s3-accesspointdualstackemrappui-prods3-websites3-accesspoint-fipsaws-cloud9s3-fipsemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9s3s3-accesspointdualstackemrappui-prods3-websites3-accesspoint-fipss3-fipsemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apis3s3-accesspointdualstacks3-deprecatedanalytics-gatewayemrappui-prods3-websiteaws-cloud9emrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9vfss3s3-accesspointdualstackemrappui-prods3-websiteaws-cloud9emrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9eu-west-3ap-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1mx-central-1me-central-1ca-central-1il-central-1ap-northeast-1us-northeast-1ap-southeast-1me-south-1af-south-1ap-south-1ap-southeast-7us-west-2eu-west-2ap-east-2us-east-2ap-southeast-2ap-northeast-2ap-southeast-5us-gov-west-1us-gov-east-1ap-southeast-6ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1mrapaccesspoints3s3-accesspointdualstacks3-deprecatedanalytics-gatewayemrappui-prods3-websites3-accesspoint-fipsaws-cloud9s3-fipsemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9s3s3-accesspointdualstacks3-deprecatedanalytics-gatewayemrappui-prods3-websites3-accesspoint-fipsaws-cloud9s3-fipsemrstudio-prods3-object-lambdaemrnotebooks-prodexecute-apicloud9s3eu-west-3ap-south-2eu-south-2computes3-ap-northeast-2elbrdss3-ap-east-1s3-sa-east-1s3-us-gov-west-1s3-eu-central-1s3-ca-central-1eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3s3-website-us-west-2s3-website-eu-west-1s3-external-1eu-central-1me-central-1ca-central-1il-central-1s3-us-west-1s3-eu-west-1s3-website-sa-east-1s3-website-ap-southeast-2ap-northeast-1ap-southeast-1s3-us-west-2s3-eu-west-2me-south-1af-south-1eu-south-1ap-south-1us-west-2eu-west-2us-east-2s3-website-ap-southeast-1s3-1s3-globals3-ap-northeast-3eu-north-1airflowap-southeast-2s3-us-gov-east-1s3-fips-us-gov-east-1s3-me-south-1s3-ap-south-1ap-northeast-2s3-website-us-west-1ap-southeast-5s3-eu-north-1s3-ap-southeast-1s3-website-us-gov-west-1compute-1s3-eu-west-3us-gov-west-1s3-website-ap-northeast-1us-gov-east-1s3-fips-us-gov-west-1s3-website-us-east-1s3-ap-southeast-2ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1s3-us-east-2s3-ap-northeast-1authauthauth-fipsauth-fipseu-west-3ap-south-2eu-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1mx-central-1me-central-1ca-central-1il-central-1ap-northeast-1ap-southeast-1me-south-1af-south-1eu-south-1ap-south-1ap-southeast-7us-west-2eu-west-2ap-east-2us-east-2eu-north-1ap-southeast-2ap-northeast-2ap-southeast-5us-gov-west-1us-gov-east-1ap-southeast-6ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1eu-west-3eu-south-2ap-southeast-3eu-central-1ca-central-1ap-northeast-1ap-southeast-1ap-south-1us-west-2eu-west-2us-east-2eu-north-1ap-southeast-2ap-northeast-2ap-southeast-5eu-west-1us-east-1ap-east-1sa-east-1csrframeservicesbuilderstg-builderdev-builder*ociocpocsazuregcpawsdemoinstanceeu-west-3ap-south-2eu-south-2eu-central-2ap-southeast-3ap-southeast-4ap-northeast-3eu-central-1me-central-1ca-central-1il-central-1ap-northeast-1ap-southeast-1me-south-1af-south-1eu-south-1ap-south-1ap-southeast-7us-west-2eu-west-2us-east-2eu-north-1ap-southeast-2ap-northeast-2ap-southeast-5us-gov-west-1us-gov-east-1ap-southeast-6ca-west-1us-west-1eu-west-1us-east-1ap-east-1sa-east-1previeweu-4us-4us-1eu-1us-2eu-2us-3eu-3appscomputepaasrag-cloudrag-cloud-chjcloudjcloud-ver-jpcdemonodebalancermembersipeuxvsoncillaocelotonzayalilynxsphinxfentigercustomercaracalo365cloudstaticxendevapp001testcode-builder-stgplatformmediasiteprojedrydpagesjsx0desazacncoitrueu4uhkukgrbrushatenadiarymyspreadshopfrom-flfrom-wvwebspace-hosttheworkpchatenablogcursorusercontentservesarcasmapplinzisakuratanwixsiteappchizigiizeis-into-carsdnsiskinkyadobeaemcloudis-a-therapistpgfogmyvncdojinis-an-actress1kappfldrvkozowqa2jpnmexprgmrfirewall-gatewaydynnscafjsfbsbxooguyfrom-gawoltlab-demois-a-anarchistwiardwebteaches-yogadattowebtb-hostinglive-websiteservegamegotpantheonfrom-nhsubsc-payfrom-ohvipsinaappfrom-cadyndns-officehomelinuxfrom-mahercules-appservebbsstreakusercontentfrom-okfrom-wyfastly-terrariumis-a-llamaqualyhqportalserveexchangeon-vaporvivenushopciscofreakgrayjayleaguesmetaaiusercontentfrom-iais-a-libertariansaves-the-whalestaveusercontentyolasiteoperaunitepoint2thisis-a-catererclaudeusercontentlinodeusercontentfrom-vagithubusercontentsells-for-lesshosteurcanva-appsplaystation-cloudddnsfreefrom-pafrom-prfrom-waddnskingoutsystemscloudhotelwithflightmydattois-a-nascarfanmydbserverminiserverdamnserverservehumouris-a-playerfrom-nvfrom-nmemergentagentgentappsamplifyappfrom-kyis-an-accountantnfshostserveircfrom-akpythonanywherestackhero-networkpostman-echolikescandydyndns-mailobservableusercontentserveftpfreeboxosfrom-utcdn77-storageamazonawsneat-urldyndns-serverlinodeis-a-teacherfrom-vtgleezemythic-beastsus1-pleniteu1-plenitla1-plenitpaywhirlservecounterstrikejdevcloudhealth-carereformis-into-animegoogleapisis-a-painterafricaisa-hockeynutatmetais-an-actora2hostedis-a-democratdatadetectest-le-patrondigitaloceanspacesis-a-designeris-a-hunterlinodeobjectstemp-dnsissmarterthanyoufrom-arsimplesiteevennodetownnews-stagingis-a-liberalgooglecodejelasticservemp3qualyhqpartnerdyndns-free1cooldnsest-a-la-masiondrayddnsdynuddnsfrom-orfrom-miis-a-bloggerfrom-himydobisscanvacodeis-an-engineerest-a-la-maisonupsunappdevinappswafflecellmyasustorwpenginepoweredfrom-ctservep2psame-appmyshopblocksthingdustdatalikes-piediscordsezis-with-thebandlpusercontentis-leetshopitsite3utilitiesis-a-personaltrainersinaappladeskis-a-cheflogoipselfipbase44-sandboxnospamproxyalibabacloudcsmesswithdnsauthgearappsiamallamawithgooglelutrausercontentmochausercontentframercanvasmytabitdyndns-homew-credentialless-staticblitzcpserverdiscordsaysis-a-nurseappspotatlassian-isolated-3premotewdfrom-mtwixstudiocode0emm180rmyactivedirectoryawsappsmytuleapdnsabrpolyspaceqbuserrenderbuiltwithdarkboutirgotdnsabrdnsdopaascanva-hosted-embedawsglobalacceleratorhomesecuritypcmyiphostditchyouripclever-clouddyndns-ipon-aptibleis-a-musicianhosted-by-filessecuritytacticsappspaceusercontenthomeunixstrapiappsame-previewcf-ipfsmycloudnaselasticbeanstalkis-certifieddontexistkasserverik-serverdrive-platformatlassian-3pfirebaseappherokuappawsapprunnerbarsycenteris-a-cubicle-slaveservehttpmyshopifyis-a-guruquicksytessiiitesorsitesmagicpatternsappis-a-cpameteorappfrom-wiis-a-rockstarbumbleshrimpdattolocaldatabricksappsreadthedocs-hostedfrom-rifamilydsdyndns-picsplesknsbplaceddnsaliasdynaliasdyndns-remotedoomdnsip-ddnsblogdnsis-a-doctorroutingthecloudamazoncognitobarsyonlinedsmynasddnsgurucloudflare-ipfsdeus-canvasfrom-idsmushcdnpagespeedmobilizerdyndns-at-homeunusualpersonhosted-by-previderis-a-republicandyn-o-saurstreamlitappworkisboringonthewificprapidqualifioappis-uberleetis-slickgetmyipwpdevcloudtypeformdyndns-at-workgentlentapismynascloudw-corp-staticblitzfrom-ingeekgalaxyservebeerfrom-mdonrenderspace-to-rentaivencloudappspacehostedwafaicloudcodespotblogspotatlassian-3p-us-gov-modfrom-ndfrom-msis-a-techieis-a-studentcustomer-ociis-a-photographerdurumisfrom-ksmassivegriddyndns-wikiis-an-entertaineris-a-hard-workermysecuritycamerafrom-mnrackmazedyndns-blogis-a-bulls-fanwritesthisblogfreemyipsimple-urlfrom-sdreservdauthgear-stagingest-mon-blogueuris-into-gamesrice-labsxtooldevicesakurawebis-an-anarchistoraclecloudappsdyndns-worksells-for-urhcloudfrom-dcfastvps-serverwpmucdnis-a-geekscrysecfrom-txis-into-cartoonsmodelscapetrycloudflarelocaltonetstreak-linkbalena-devicesfrom-njforgeblocksfreebox-oswebadorsitefrom-ncdoesntexisthobby-sitestreaklinkshomesecuritymacownprovidertuleap-partnersdattorelaywphostedmailservequakeis-a-socialistservehalflifepivohostingdynuhostingquipelementsw-staticblitzdyndns-webfrom-deproject-studyaliases121is-not-certifiedhercules-devis-a-financialadvisoramazonlightsailservepicsis-a-greenloseyouripfrom-ilwithyoutubemwcloudnonprodwiredbladehostingdnsdojofrom-tnpixolinomyqnapcloudis-an-artisthostedpiis-a-landscaperauiusercontentoaiusercontenton-forgeis-a-conservativedreamhostersnet-freaksapps-1and1is-goneencoreapifastly-edgefrom-nesalesforcefrom-scdeployagentoraclegovcloudappsfrom-alis-a-lawyercechirevultrobjectsstufftoreadisa-geekddnsgeeklovableprojecttry-snowplowfrom-moblogsyteis-a-bookkeepernogmyforumravendbmyboxdeelementoredsaacficogoorinforgcomgobnatneteduidstoreorgcomnetintedudevnomepublorgcomneteduathgovtestscalculatorspaynowinfoquizzesresearchedcloudnsfunnelsassessmentsjscaleforcetmacltdorgmilcompronetgovbizpresseklogesrsccloudcustomfltusrcloude4corealmgovmunicontentproxy9metacentrumdyndyndyndnsdynpagespages-researchitionoccustomercomymyspreadshopipv64diskussionsbereich4limacomrub2ixfirewall-gatewayddnssspdnsbarsykeymachinesquare7myhome-serverspeedpartnercommunity-proschuldockxenonconnectgünstigliefernbwcloud-os-instancedyndnssecmy-routerxn--gnstigliefern-wobin-butterl-o-g-i-nisteingeekin-dslin-berlinin-brbfuettertdasnetzleitungsenin-vpnlcube-serverdyn-ip24logoipdyn-berlinruhr-uni-bochum12hpgoipsrvdnsfruskygit-repossvn-reposinternet-dnsgünstigbestellenhome-webserverxn--gnstigbestellen-zvbbplacedheimdnscosidnswebspaceconfiglima-citydyndns1istmeinvirtualuserschulplattformmy-gatewayddnsseclebtimnetztest-iservmein-iservvirtual-userhome64iservschuletaifun-dnstraeumtgeradeschulserverdynamisches-dns123webseitednshomehs-heilbronndnsupdaterbssgraphicdwadpdwdaepeweaawapaafpfwfabwbpbacwcpcciwebuserapiobjects*teamst3r2lpbravepanelngrokiservstglclcrmerpflypagesbarsyvivenushoplocalcertlocalplayerbearbloggatewaydeno-stagingis-not-ais-a-goodbotdashvercelmocha-sandboxplatter-appreplitgithubpreviewworkersinbrowserevervaultis-ahrsndenoxmitmodxmyaddrstorageapipayloadgrebedocruncontainersstgstagelclstageloginlineis-a-fullstackcodepenleapcellngrok-freeis-coolstoragewebharemediatechlibp2pdiscourseimaginecomyspreadshopstoreregbiz123hjemmesidefirmcoorgcomnetedugovsldorgmilcomwebgobartnetedugovtmorgpolcomsocartnetedugovassoagrondiscoodontk12medcuegyecpaabgengorgmilgalsaltulcomadmesmgobpubdocmonfindgnriouioproartlatvetnetfotedulojgovntrturibrbarxxxofficialbasechefprofmktgpsictechinfoarqtcontdentrrpppsiqgit-pagesritmedfieorgcomlibprieduaipgovriikmeactvsportorgmilcomscieunnetedugovnameinfopintouchtawktotawkmyspreadshoporgcomnomgobedu123miwebcomputeorgcomnetedugovbiznameinfocognito-idpeusc-de-east-1onjelasticnxaspdnsbarsydirectwpdeuxfleurstransurldogadoprvwcloudnsamazonwebservicesdnshomeuserpartycokoobinmkmfidymyspreadshopalandkapsiikixn--hkkinen-5wacloudplatformhäkkinen123kotisivuidacorgmilcompronetedugovbiznameinforadioorgcomneteduuserexperts-comptablestmmyspreadshopgretaprdcomnomynhccifbxoshuissier-justicenotairesaeroportfreeboxoson-webavocatassoportgouvkdnschirurgiens-dentistes-en-franceavouesfbx-os123sitewebveterinairechirurgiens-dentistespharmacienchambagrimedecinfreebox-osdediboxgoupilemszicpyicpvicppleysheezypagesedugovcnpyorgcomcybllcpvtnetedugovtnxonlineschooldaemond6atcopanelorgnetplybotdashstackitkaasorgmilcomnetedugovbizmodltdorgcomedugovcoorgcomneteduappwriteacorgcomnetedugovcloudtranslateusercontentorgcomnetedumobiassoorgcomnetedugovbarsysimplesitediscourseindorgmilcomgobneteduorgcomwebnetedugovguaminfonxhra教育敎育網絡网絡组織組織网络網络组织組织公司政府個人个人箇人ltdorgcomincneteduidvgovxn--uc0ay4axn--55qx5dxn--mk0axixn--io0a7ixn--uc0atvxn--zf0avxxn--lcvr32dxn--od0algxn--wcvs22dxn--gmqw5axn--od0aq3bxn--mxtq1mxn--ciqpnxn--tn0agxn--gmq050iorgmilcomgobneteduiservwp2tempurlmircloudfreesitewpmudevmyfastgadgetcloudaccessjelehalfboltfastvpsemergenteasypanelopencraftizcombrendlynamefromrtpersoadultmedorgpolrelcomproartnetedufirminfoassoshopcoopgouvtmcomediahotelforumvideosportorgsexagrargameslakaseroticaerotikatozsdereklamcasino2000filmsuliinfoboltshopprivnewsszexcityutazasjogaszkonyveloingatlaneacaicogoormyᬩᬮᬶmilwebschnetkopbizzonedesaponpesxn--9tfkymyspreadshopgovmytabittabitorderravpageaccok12idforgnetgovmuniltdplcaccotttvorgcomnetmeca6g5gpgamubacaicniocoukuptverdruscsdelhiindorgmilcomwebnicfingenpronetintedugovresbizbiharbarsyinternetbusinessschooltravelsupabasealumnigujaratfirminfoaeropostbankcoopindevscloudnsno-ipbarsybarrell-of-knowledgebarrel-of-knowledgensupdategroks-thisdnsupdatefor-ourknowsitalldvrcammittwalddynamic-dnsv-infowebhopselfipdyndnshere-for-moreilovecollegemayfirstforumzcloudnsmittwaldservertypo3servergroks-theeusekd1cdndyndnsidrawsainaueuapjpusstagemocksysdevicesclientcustreservdcustdevdisrecprodtestingcobeebyteutwenteboxfusebravepstmndedynngrokorgmilcomnomnetedugovqcxqzzbarsythingdustmo-siemensrb-hostingfh-muenstergitbookbluebitecloudbeesusercontentnodeartkiloappsforgerockdarklangresinstagingapigeebubbleb-datascryptedhypernodedappnodepantheonsitegitlabgithubkeeneticvirtualservercleverappshostyhostingon-rioedugitticketstelebitwixstudioon-k3sicp0icp12038jeleqotolairbubbleappsmyaddrstolosmyrdbxwebflowdrive-platformbeagleboardhasura-applolipopdefinimavaporcloudmusicianwebflowtestazurecontainerresindevicereadthedocsloginlineeditorxmoonscalesandcatsbasicserverwebthingsbrowsersafetymarkbeebyteappbitbucketidaccovistablogorgschnetgovxn--mgba3a4f16axn--mgba3a4fraarvanedgeايرانایرانjclaspeziapdudcefegelemeperetevebacanatavaparasabgagfgogrgpgalclblimfmrmcbmbvbfclcmcvcrcpcchlimifibicivipirisimncnbnanenrnpntnnolomobocoaogorosopotoptvtatctbtmtltotpusulunutpspapaqsvpvvvtvavvrtrsrprgrfrcrbrarorkrvstsssbscsmsispzczbzbozen-suedtirolmyspreadshopxn--bulsan-sdtirol-nsbxn--valledaoste-ebbtrentinoaltoadigetrentin-sued-tirolxn--forlcesena-c8axn--forl-cesena-fcbxn--bozen-sdtirol-2obtriestetrentinsuedtiroltrentino-s-tirollecceudineaostesienaparmaluccapaviagenoapaduaaostamonzaabruzzoternirietiturinmilanbozenlaziofermoleccocuneonuoropratola-speziavdataaligfvgpugmolcalcamlomumbsicpmnvenvaoedugovabrsarmaremrbastoslazibxosfirenzetrentinosüdtirolval-d-aostavalle-aostamessinacremonaravennatoscanatrentin-suedtirolbolognacalabriaurbinopesarofriuli-v-giuliaogliastraxn--valle-aoste-ebblaquilaandriatranibarlettasyncloudxn--valle-d-aoste-ehbaostavalleyvalled-aostatrentino-alto-adigevallee-d-aostexn--balsan-sdtirol-nsbpistoiasicilialucaniacataniaiserniaperugiabresciaveneziagorizialiguriaimperiabulsan-suedtirolbalsan-suedtirolbarlettatraniandriaxn--trentino-sdtirol-szbforlì-cesenatuscanyvallée-d-aostemantovavallée-aostecasertapiemontevalleaostaval-daostafriulivgiuliatrevisoforli-cesenavalléedaosteferrarapescaravald-aostatrentino-altoadigefriuli-vegiuliavallee-aostecarboniaiglesiastarantomediocampidanovalleedaostetrentinosud-tirolcampobassotrentinsüd-tiroltrentinosüd-tirolmonzabrianzatrentino-südtirolxn--trentino-sd-tirol-c3bpotenzacosenzavicenzaemiliaromagnavenicefrosinonemarchepordenonetrentinosued-tirolvaresemolisevalléeaostefriuli-veneziagiuliabasilicatalatinaanconasavonaveronamodenabiellabolzano-altoadigepugliafoggiaumbriatrentino-stirolgenovapadovamateranovararagusapiacenzatrentinostirolvalleeaostetempio-olbiasudsardegnatrentinsudtirolmassa-carrarafriuliveneziagiuliatrentinosuedtirolandria-barletta-tranitrapanixn--cesenaforl-i8amaceratacaltanissettaascoli-picenobrindisicarraramassacagliaririmininapolivibo-valentiachietibulsan-sudtirolbalsan-sudtiroltrentino-a-adigebulsanbalsaniglesiascarboniamilanotorinoteramodell-ogliastraarezzotrentinoalto-adigerovigotrentovenetoiglesias-carboniatrentino-sud-tirolaltoadigereggio-emiliareggio-calabriasardegnatranibarlettaandriapiedmontxn--sdtirol-n2amedio-campidanotrentino-süd-tirolfriuli-vgiuliafriuli-ve-giuliaromeennaromapisa32-b16-b64-blodiastibarineencomonaplesforlicesenailiadboxosalessandriasicilytrani-barletta-andriaxn--trentin-sdtirol-7vbpesarourbinotrentinsued-tirolcesena-forliforlìcesenaemilia-romagnamonzaebrianzaxn--trentinsdtirol-nsbtrentinos-tiroltrentinsüdtirolvalledaostaolbia-tempiocampidanomediovibovalentiasassarivalle-daostalombardysud-sardegnafriulivegiuliareggioemiliamonzaedellabrianzaalto-adigevercellitrentin-sudtiroltraniandriabarlettatrentino-sudtirolascolipicenobozen-südtirolfriulive-giuliaflorencexn--cesena-forl-mcbcarbonia-iglesiasaosta-valleycarrara-massadellogliastratrentinoa-adigexn--valleaoste-e7apesaro-urbinoxn--trentinosdtirol-7vbxn--trentin-sd-tirol-rzbxn--trentinsd-tirol-6vbtrani-andria-barlettatrentin-süd-tirolxn--trentinosd-tirol-rzbgrossetomonza-e-della-brianzasüdtirolreggiocalabriatrentinoaadigetrentin-südtirolverbano-cusio-ossolafriuliv-giuliaverbaniacampaniatrentino-aadigefriulivenezia-giuliasardiniaandriabarlettatranibarletta-trani-andriacatanzarooristanourbino-pesarocesena-forlìvalle-d-aostacampidano-medio123homepagesiracusatempioolbiasuedtirollombardiaavellinocesenaforlìtrentinofriuli-venezia-giuliabozen-sudtirolandria-trani-barlettabulsan-südtirolbalsan-südtirolmonza-brianzabolzanotrentino-sued-tirolbellunosalernolivornocrotonesondriodnshometrentinsud-tirolmassacarraratrentin-sud-tiroltrentino-suedtirolviterbobergamocesenaforliolbiatempiopalermobeneventoagrigentoofcoorgnetfmaitvphdengorgmilcomschnetedugovperagrikanieasukehandachitatokaiaisaikonanoharuamaobuhigashiuraowariasahiinuyamatobishimaiwakurashitarainazawatoyonegamagorimihamatoyotataharakariyayatomioguchikomakimiyoshinishiotokonamekiyosuchiryutoyohashiokazakiisshikikasugaikotakiratoeianjotogofusosetohazutsushimashinshirotakahamanisshinshikatsuhekinantoyokawaichinomiyatoyoakeodateogataakitaikawakyowahonjoogayurihonjonoshirokamiokakatagamimitanegojomeyokotekosakadaisenkazunonikahohonjyomoriyoshimisatohappoukamikoanihachirogatahigashinarusesembokufujisatokitaakitaitayanagiowanitakkomutsutsurutahirosakigonoheoirasetowadamisawanohejiaomorishingohiranairokunohehashikamitsugarushichinohehachinohenakadomarisannohekuroishisakaeisumiasahiotakiinzaiabikomatsudoyachiyomutsuzawakujukuriomigawakashiwatoganemihamanaritasakuranagaramobarahanamigawachoshishiroichoseikozakishisuikatorimidorichonankyonanfuttsuonjukufunabashinagareyamanodasosatakochuotohnoshourayasukimitsuyokaichibayotsukaidosodegauratateyamakamagayayokoshibahikariyachimatakatsuuratomisatokisarazukamogawaichikawanarashinoichinomiyashimofusaminamibososhirakoichiharaoamishirasatoikatahonaiainansaijoseiyoiyoozuuwajimaniihamanamikatamasakiuchikokihokutobetoonshikokuchuomatsuyamaimabarikamijimakumakogenyawatahamamatsunosabaeikedaobamasakaifukuiohionotsurugamihamawakasaminamiechizeneiheijikatsuyamatakahamaechizensoedaukihaomutaokawanishiogoribuzenonojosueumiokiotochikugosasagurisaigawamizumakishinyoshitomikurumekurateyamadakasuganakamamiyamanogatatakatahakataiizukakawaratagawakasuyaashiyainatsukimunakataminamitsuikishonaikurogifukuchikeisenhigashimiyakoshinguyukuhashiokagakiyamekogaongausuikahotohochuotoyotsumiyawakadazaifuhisayamatachiaraiyanagawanakagawahirokawachikujochikushinochikuhochikuzennamieotamaokumashowateneiiwakikoorinangoononishigoshimogoomotegomishimafukushimaasakawakagamiishishirakawaiitatefutabahiratayugawahanawakitakatakawamatakunimiyabukibandaihigashihironoyamatomiharuyamatsuriaizubangedatesomaaizuwakamatsuyanaizuaizumisatonishiaizuizumizakikitashiobarataishinkaneyamakoriyamainawashirotanagurafurudonosamegawasukagawaishikawatamakawaikedaogakitaruiginanenahashimahichisonakatsugawaibigawashirakawamizunamiminokamomitakekawauesekigaharatomikasakahogikitagatayamagatatajimianpachimotosuyaotsukakamigaharahidakanisekitokigujominogodoyorogifukasamatsutakayamawanouchihigashishirakawakasaharashimonitatsumagoichiyodakannakanrashowameiwakiryuotaoratomiokafujiokaitakuranaganoharahigashiagatsumatakasakishibukawaminakamikatashinatsukiyonokawabanumataannakaoizumimidorishintoisesakiuenoyoshiokakusatsutakayamanakanojonanmokutamamuratatebayashimaebashiotakekaitadaiwahongofuchukuietajimashobaramiharahatsukaichihigashihiroshimamiyoshikumanokurenakasakaseraseranishiasaminamifukuyamashinichionomichiosakikamijimajinsekikogentakeharaotobenanaeikedatohmaozoraobiraabirakyowaeniwataikibibaisharirebunerimohiroooketootarupippunishiokoppechitosefurubirahakodateshiranukakitahiroshimakushiroobihironanporoiwamizawaniikappukunneppufukushimanakasatsunaitoyourakuromatsunaiakabirakamisunagawashibechaurakawakamifuranonakatombetsuasahikawashimokawakayabeokoppebiratoriabashirisaromaatsumanumatahidakabifukamukawamikasahorokanaitoyotomisarufutsuhigashikawaishikarikitamiyoichiesashiiwanaitomariminamifuranoakkeshifuranotoyakoyakumootoineppushikaoishiraoinemuronayorohaboroashorobihororishirifujiutashinaihokutotakasuebetsuurausuassabukikonaishimamakinaiedatetoyabieinikiesanuryuoumuteshikagarikubetsuashibetsukimobetsuaibetsutobetsusobetsuembetsushimizuchippubetsurishirihokuryuhoronobeshintokutsubetsushibetsuhonbetsumombetsutsukigatakuriyamakoshimizushiriuchikutchanmurorannoboribetsukamishihorowassamushinshinotsukembuchiwakkanaikamoenaikiyosatotakinoueshikabesunagawafukagawanakagawatakikawakamikawahigashikagurahamatonbetsumatsumaemoseushirankoshishakotanimakanemashikeotofuketomakomaisandatambaitamiawajikasaiasagoshisoonoakoyashirotoyookaminamiawajiinagawafukusakitakasagokamigorikasugaharimayokawaashiyahimejiakashitaishiaogakisannantakinosumototakarazukanishinomiyashingugoshikinishiwakiyokatakaaioimikisayoyabukawanishiamagasakisasayamashinonsenkakogawaichikawakamikawatatsunotsukubaiwamaogawaasahisakaitokaioaraiitakobandodaigosuifuinaamikasumigaurakashimaomitamayachiyoshimodatetomobetoridehitachinakainashikisakuragawakasamayawaramoriyahitachiomiyanamegatayamagatahitachikamisuushikutakahagiibarakitonekoganakasowayukimihojosomitoryugasakishimotsumafujishirotsuchiurachikuseihitachiotashirosatotamatsukuriuchiharashikahakuinanaotsubatawajimakahokukawakitatsurugikaganominotosuzuuchinadakomatsuanamizunakanotohakusannonoichikanazawaiwateshiwafudaikawaimoriokaofunatohanamakikuzumakikitakamininohekunoheyamadayahabasumitaichinosekitanohatahiraizumirikuzentakatajobojiotsuchihironomiyakoiwaizumikarumaiichinohenodakujitonooshushizukuishifujisawamizusawakamaishikanegasakimannoutazukotohiraayagawazentsujihigashikagawauchinomikanonjisanukimarugamemitoyotakamatsutadotsunaoshimatonoshoakuneamamiizumihiokiyusuikinkoisasookouyamanakatanekagoshimakanoyaisenkawanabeminamitanemakurazakitarumizunishinoomotematsumotosatsumasendaioimatsudaayaseebinamiurazushinakaiodawaraiseharasagamiharahakoneaikawakaiseiatsugitsukuihadanoyamatoyamakitazamaoisochigasakininomiyayokosukakamakuraminamiashigarafujisawasamukawakiyokawahiratsukayugawaraokawaumajikochitsunootoyoakiinonishitosayasudahidakamiharasakawaniyodogawahigashitsunokagamigeiseisusakiotsukinaharisukumomurototosakamiochitoyotosashimizumotoyamanankokunakamurakitagawayusuharaogunichoyoukiasoutoozugyokutoamakusamifunetakamoriyamagaminamataminamiogunikikuchisumotoyamatonagasumashikiaraokumamotokamiamakusanishiharayatsushiroayabeseikasakyoideineujinakagyokameokakyotangokyotanabekyotambaminamiyamashiroyamashinatanabeyawatawazukaminaminantanmiyazuhigashiyamafukuchiyamakitamukokamojoyokizumaizuruujitawaraoyamazakinagaokakyokumiyamakawagoeinabeshimameiwaasahitaikiudonoisetsukisosakikuwanamihamamiyamasuzukatamakimisuginabarikumanokomonominamiisewataraitobakiwatakikihotadomatsusakayokkaichikameyamaureshinoishinomakishichikashukuohirataiwaosakizaohigashimatsushimashikamaiwanumashibataogawaraonagawakawasakiseminemarumoriminamisanrikukakudamuratawakuyatomiyanatoriwataritagajomisatotomekamirifushiroishimatsushimayamamotoshiogamafurukawahyugaebinotsunosaitoayakushimanobeokakitauramiyazakitakazakigokaseshiibamimatashintomikunitomikitakatakobayashikawaminamitakaharukijotakanabemiyakonojonishimeranichinankitagawakadogawamorotsukakisofukushimaminamimakisakaeobuseikedaogawamiasaokayaasahiotakiotarichinoinaomichikumakomaganechikuhokukaruizawayasuokaooshikaikusakaminamiaikitogakushimatsukawakawakamitateshinatakamorikitaaikishiojirimiyadahakubaiizunaiijimaiiyamamiyotasuzakayasakatoguraookuwanagawaminowahirayayamagataminamiminowafujimiomachisakakitakaginaganonakanosakuhokomoronagisoshinanomachiwadauedaiidaharasuwatomiachiaokianankisosakunozawaonsenagematsutakayamashimosuwamatsumotoyamanouchinakagawamochizukiazuminotatsunoobamaomuraseihiunzenosetofutsuikichijiwanagasakiisahayahasamisaikaikawatanasasebohiradokuchinotsugototogitsutsushimashimabarashinkamigotomatsuurayamazoekashibaikomakawaitenrioyodosangokoryoudaojiikarugayamatokoriyamatenkawakatsuragikurotakikawakamimiyakemitsuetakatorikamikitayamayamatotakadahegurishinjokanmakisakuraitawaramotogoseoudanarasoniandokawanishishimoichihigashiyoshinokashiharashimokitayamanosegawayoshinomintsivorytopazsakuragehirnsumomoaseinetopalmail-boxmokurenyoitamuikaojiyagosensanjoaganomyokoseiroagaomishibataniigatanagaokamurakamiuonumayuzawakariwatagamitainaitsunanminamiuonumatochioyahikojoetsuseiroukamosadoizumozakitokamachiitoigawasekikawakashiwazakitsubamemitsukekokonoesaikiusukibeppuusahimeshimakunisakihasamataketatsukumihitaoitahijikusuyufukujukamitsuebungoonobungotakadaibaraniimibizentsuyamaokayamakasaokahayashimayakagemaniwaakaiwamisakishinjotamanotakahashikibichuowakesojanagishookumenannishiawakurakurashikiasakuchisetouchikagaminosatoshotomigusukunakagusukuyaeseizenaurumaiheyaaguniogiminanjokinminamidaitokitanakagusukuyonaguniokinawaishigakikunigamiurasoekadenataramahiraraginozataketomishimojizamamitonakiitomanhigashimotobuyonabarugushikamionnanahanagohaebarukumejimakitadaitonakijinnishiharayomitanginowantokashikiishikawaikedasuitaminohizuminishisakaikananabenodaitoosakasayamayaokishiwadatadaokakaizukatondabayashichihayaakasakakumatorikadomasayamahigashiosakashijonawatehirakatataishimisakitajirihannansennankatanotoyonominatosettsuhigashiyodogawaibarakinosekitachuohigashisumiyoshifujiiderakashiwaraizumiotsutoyonakamatsubaramoriguchiizumisanoshimamototakatsukineyagawahabikinotakaishikawachinaganoyoshinogarikamiminearitaouchiimarihizenogikashimaariakekiyamafukudomikitagatakitahataomachigenkaikanzakinishiaritakyuragisagataratosutakushiroishikaratsuhamatamakouhokukawagoeyoshidasatteogoseirumaasakaurawaogawaniizaomiyayoriiotakishikihonjooganohannohanyuinasaitamaokegawaarakawayoshikawayokozehasudasayamahidakafukayachichibuiwatsukiryokamiyoshimikamiizumifujimiwarabiranzanmiyoshiminanoyashiosakadosugitomisatohigashichichibutodasokakukiyonokazoshiraokakasukabekounosukawajimatsurugashimamiyashirokitamotohatoyamamoroyamahatogayakumagayakawaguchinagatorokamisatomatsubushinamegawatokigawakamikawafujiminohigashimatsuyamakoshigayatokorozawas3isk01isk02ryuohkoseikonanaishorittotakashimamaibarahikonetorahimenishiazaikokagamokotoyasuotsukusatsunagahamamoriyamatoyosatotakatsukinotogawaomihachimanhigashiomiakagiunnanizumogotsuamayatsukakakinokimatsuehamadamasudahikawahikimiokuizumoyasugiyakumomisatotamayuohdahigashiizumookinoshimanishinoshimatsuwanoshimaneshimadafujiedayoshidashimodagotembaiwataatamikosaiyaizuitoizumishimahaibaramakinoharaomaezakikawanehonkannamisusonohigashiizufukuroinumazukawazufujiaraishizuokahamamatsushimizuizunokunimatsuzakimorimachiminamiizunishiizukikugawakakegawafujikawafujinomiyaujiietsugaoyamayaitaohiranikkoashikagakuroisokanumasakurashioyakarasuyamamotegiichikaikaminokawatochigihagamokanogisanobatonasumibunasushiobaranishikatautsunomiyaiwafunemashikoshimotsukeohtawaratakanezawaitanokomatsushimatokushimaichibaminamiaizumiwajikikainanmiyoshinarutomimamugiananmatsushigesanagochishishikuinakagawamachidachiyodakomaefussainagitaitochofufuchuomeotahigashiyamatotoshimaokutamaaogashimakodairaedogawaarakawahachiojishinagawatachikawashibuyasuginamihinodekiyosesumidaoshimanerimamitakahamuraadachinakanomizuhobunkyomegurominatokoganeihigashikurumekokubunjihigashimurayamamusashimurayamatamakitahinochuokotokatsushikakouzushimaogasawaraakishimakunitachishinjukusetagayamusashinohachijoitabashiakirunohinoharachizunanbukotouramisasawakasayonagokogehinoyazutottorinichinansakaiminatokawaharaoyabetairainamiasahinantoimizufuchutakaokakurobeyamadajohanatoyamatonaminyuzenfunahashinakaniikawanamerikawaunazukitogahimiuozufukumitsutateyamakamiichiiwadearidayuasainamitaijikatsuragiaridagawatanabemihamahidakakainankiminomisatoshingushirahamakamitondayurakozakoyagobokitayamawakayamakudoyamahashimotokushimotokozagawahirogawakinokawanachikatsuurarsuseroeoishidasagaeoguniasahinagaitendonanyoobanazawanishikawasakataohkuratozawamikawamamurogawayamagatafunagatatakahatashonaishinjokahokuiideyuzakawanishitsuruokakaminoyamayamanobeshiratakamurayamanakayamakaneyamahigashineyonezawasakegawamitouubeyuuabushimonosekitabuseoshimatoyotaiwakunihikarishunannagatohagihofukudamatsutokuyamashowadoshitsurunanbukoshukaiminami-alpsnirasakikosugeotsukioshinohokutominobuyamanashifuefukichuokofuichikawamisatoyamanakakonakamichitabayamanishikatsuranarusawafujikawahayakawafujiyoshidafujikawaguchikouenohara長野京都岐阜大阪三重群馬千葉滋賀佐賀奈良adednelgaccogogror秋田愛知高知埼玉沖縄栃木熊本岩手青森山梨新潟島根鳥取長崎香川宮城石川大分宮崎茨城山口兵庫山形徳島広島福島福岡岡山富山静岡愛媛福井東京xn--4it168dhatenadiaryxn--vgu402ckawaiishophatenablogcocottenamaste北海道penneehimeiwateversestabachibashigagonnagunmapermahaccaakitaosakauh-ohblushkochiaichifukuikuroncapooitigohyogotokyokyotopunyuthickcheap0t00g00j0mie2-ddaapyawjg0amfemsubxiiboomoobutchueekpgwrgrherskrboyrdyupperunderflierchipsmydnsheavyangryhippygirlyrulez神奈川鹿児島和歌山bambinaxn--nit225kokayamasaitamaxn--k7yn95exn--1lqs03nsapporoparasitelolipopmcxn--efvn9sniigatafukuokatokushimafukushimahiroshimakagoshimafakefurokinawaxn--8pvr4ucoolblogxn--0trq7p7nnkawasakinagasakimiyazakichilloutxn--8ltr62kxn--klty5xpeeweezombiecutegirlxn--rny31hxn--uuwu58axn--ntso0iqx3axn--djrs72d6uytoyamanikitanyantakagawamimozanagoyaboyfriendxn--2m4a15egreaterchowderegoismyamagatafashionstorexn--elqq16hxn--pssu33lsendaimiyagixn--rht27zpecoriaomorisaloonwatsonvivianxn--djty4knobushipigboatnaganopinokoxn--f6qx53asadistvelvetsecretxn--5js045dchicappayamanashiibarakidigickgirlfriendxn--1lqs71dmongolianxn--c3s14mxn--qqqt11mtochigixn--5rtq34kparallelo0o0mondkobesagabonadecaoitanarafoolkilldecimainhiholomosblokilociaoundopupugifutankcrapflopnooroopsmodsholyjeezstripperpepperbittershizuokaxn--rht3dkitakyushureadymadeicurusversusmatrixxn--rht61ehungryfloppygloomycrankyhandcraftedlittlestarxn--klt787dxn--kltx9awhitesnowsunnydaytottorilovepoptheshopbuyshopxn--5rtp49cxn--d5qv7z876cwebaccelxn--kbrq7oxn--4pvxsxn--1ctwolovesickkumamotocatfoodxn--tor131oyokohamawakayamatonkotsuxn--ehqz56nxn--uist22hxn--6btw5axn--kltp7dyamaguchifrenchkisspussycatxn--4it797kxn--uisz3gbabybluexn--zbx025dnetgamersxn--7t0a264ckanagawaxn--6orx2rishikawaxn--ntsq17ghalfmoonschoolbusjellybeanxn--mkru45iusercontentlolitapunkxn--32vp30hsakurastoragehokkaidoshimanecandypopbabymilksupersaleweblikeraindropbackdropwebsozaikikirarahateblodaynightmeneacsccogoormobiinfoaeusxxorgmilcomnetedugovorgcomnetedugovbizinfotmprdorgmilcomnomedugovassnotairespresseassocoopgouvveterinairemedecinpharmaciensorgnetedugovtraorgcomedurepgovmeneperekgacscaiiocogoitoresmshsseoulbusanulsandaeguc01milvkimmvchungnamjeonnamjeonbukeliv-dnsgyeonggijejueliv-cdnincheondaejeongangwongyeongbukgwangjuchungbukgyeongnameliv-apicoeduindorgcomembnetedugovorgmilcomnetedugovjcloudorgcomnetintedugovperbnrinfocooyorgcomnetedugovethipfscanvamypepethw3sstorachakeeneticjoinmcinbrowserdwebcyonnftstoragemyfritzaemewphlxachotelltdorgcomwebsocschngonetintedugrpgovassnomgacsccoorgnetedugovbizinfo123websiteidorgmilcomasnnetedugovconfidmedorgcomplcschnetedugovaccoorgnetgovpresstmassoirseproxaccosoundcasthoptocraftvp4c66orgnetedugovitsmcdirmyboxbarsyedgestacksynologylogintoopencloudnohostwebhopdiskstationi234tcp4hoocgroknoipprivmydsddnsdnsforlohmustransipdscloudfilegear-sgbrasiliafilegearframerbarsybarsyonlinecoprdorgmilcomnomedugovinforgcomnetedugovnameacprorgcomartnetedugovpresseinfoassoinstgouvorgnycedugovbarsydscloudjuorgcomnetedugovminisiteaccoororgcomnetgovorgmilcompronetintedugovbizmuseumnameinfoaerocoopaccoorgcomnetintedugovbizcooporgcomgobneteduorgmilcomnetedugovbiznameaccoorgmilneteduadvgovcoorgcomnetaltgovforgotherhiskeeneticispmanagernomassoprod5476132eastasiacentraluswesteuropewestus2eastus2pnortheurope-01newzealandnorth-01southindia-01southcentralus2-01norwaywest-01eastus2-01westus2-01australiaeast-01italynorth-01israelnorthwest-01swedencentral-01westeurope-01centraluseuap-01taiwannorthwest-01uaecentral-01northcentralusstage-01israelcentral-01mexicocentral-01canadacentral-01austriaeast-01germanywestcentral-01francecentral-01ukwest-01denmarkeast-01polandcentral-01eastus-01westus-01swedensouth-01eastus3-01westus3-01brazilsouth-01centralus-01francesouth-01australiacentral-01westindia-01uaenorth-01jioindiacentral-01canadaeast-01belgiumcentral-01spaincentral-01koreacentral-01chilecentral-01qatarcentral-01westcentralus-01eastus2euap-01norwayeast-01southafricanorth-01brazilsoutheast-01germanynorth-01switzerlandnorth-01switzerlandwest-01japanwest-01southafricawest-01japaneast-01eastasia-01indiasouthcentral-01taiwannorth-01centralindia-01uksouth-01southcentralus-01northcentralus-01eastasiastage-01indonesiacentral-01australiacentral2-01australiasoutheast-01malaysiawest-01koreasouth-01southeastasia-01southeastus5-01northeastus5-01jioindiawest-01rucdnwest1-usfra1-desandboxjls-sto1jls-sto3jls-sto2aglobalabglobalsslmapprodfreetlsmapvpslon-1lon-2ny-1fr-1sg-1ny-2paassnwebpaashostingjelasticnordeste-idcsocuserpagescwebfileblobservicebuscoreatlricnjsjelasticwebsitestoragesezagbinruhuukjptsmyspreadshopmynetnameakamaiorigin-stagingfrom-coipv64dynv6cdn77serveblogadobeaemcloudhicamsprytdnsupno-ipownipde5ovhicpfirewall-gatewaysytesmypsxbarsyusgovcloudapimyamazemyradwebakamaihdsaveincloudfastlylbfrom-lasubsc-paysquare7in-the-bandblackbaudcdnhomelinuxoninfernoctfcloudservebbsdns-dynamiccloudfrontakamai-stagingipifonyham-radio-opsenseeringclickrisingcommunity-profrom-nylocalcertgrafana-devedgesuite-stagingcloudflareanycasteating-organicatlassian-devmydattofeste-iplocaltotorprojectknx-serveredgekeycloudflareglobalcloudyclustercasacamserveftpakamaized-stagingakamaiorigindns-cloudmyeffectboomlabotdashbuyshousestwmailhetemlazure-mobilein-dslthruhereredirectmedynuddnsbouncemesupabaseluyanicloudappakamaicloudfunctionsdebiannhlfanpgafanstatic-accessin-vpnmysynologymafeloappudohomeftptrafficmanagersiteleafseidatmemsetcloudflarecloudaccesskeyword-onazure-apiis-a-chefdoes-itgets-itwebhopselfiphomeipkicks-assedgesuitewindowsserver-ontunnelmolemydissentscrapper-sitecloudflarecnuni5srcfggffiobbzabchrsndenodynuopikddnsvpndnsakadnselastxkinghostvps-hostfastlyhomeunixazureedgeshopselectdontexistmyfritzcloudjiffyalwaysdatasells-itsquaresbroke-itazurefddattolocalat-band-campmeinforumfamilydsazurestaticappsdefinimabplaceddnsaliasdynaliasnow-dnsblogdnsroutingthecloudendofinternetdsmynasakamaiedgemymediapcadobeio-staticakamaiedge-stagingakamaihd-stagingddns-ipprivatizehealthinsurancelive-onkrellianschokokeksmassivegridmysecuritycamerarackmazeserveminecraftfrom-azis-a-geekakamaizedmoonscaleoffice-on-theusgovtrafficmanageradobeioruntimeedgekey-stagingreserve-onlinechannelsdvrdnsdojousgovcloudappcdn77-sslapps-1and1podzoneazurewebsitesdynathomescaleforceyandexcloudvusercontentisa-geekcdn-edgescoaemalcesappwriteazimuthtlonarvobuiltwithrocketnoticeablestorecomwebrecnetperotherfirminfoartslgdloncogoiltdorgmilcolcomplcschgenngonetedugovbiznamefirmmobiacincoorgmilcomnomwebgobnetintedubizinfocomyspreadshopdemongovtransurl123websitehosting-clusterkhplaycistrongsnesosvalervålerxn--vler-qoaossandeheroysandeherøybøboheroyherøyxn--hery-iraxn--b-5gavalerbøboxn--b-5gasandesandexn--hery-iraxn--vler-qoavålerhåreålaahavaofsfvfhlolnlalrlhmfmtmahcostntbuåstrmreigersundmyspreadshopgálsáeidsvolltingvollgildeskalflorøvadsøvardøvanylvenxn--bhccavuotna-k7astrandaxn--kvnangen-k0axn--sknland-fxaxn--mosjen-eyarakkestadhyllestadnannestadvevelstadvaapstenordre-landsondre-landsøndre-landtjieltexn--vrggt-xqadsør-aurdalsor-aurdalheradstordmoldefordeførdeseljefedjeryggehemnexn--krehamn-dxasognegranesøgnebrynetjomevallebykletokkegiskedovretjømehobølvoldasaudatolgasømnaviknadønnasomnadonnatranafrananesnaraumasmolatrænafrænalesjasmølaørstaorstahitrafloraaukraloppafrøyarissasnasahalsagalsaromsaraisaráisafroyasnåsagronghobolfjelltydalårdalardalaskimharamkraanghkekråanghkesorumbarumhurumbærumsørummodumsálátbálátfrognbjugnvåganvagangulenskienløtenlotenstrynvefsnxn--merker-kuaskaunsveiobømlobomloskjåkvardoflorovadsosalatbalatsálatklæbuklabuselbubarduulvikskjakklepprisørxn--nttery-byaeflåeidflahofmilgolholsellomskifetvikdepvgsfhsaskerrisorhamarasnesåsnesrørosrorosxn--slat-5namasoynaroyvaroyluroydyroyaskoyradoyandoyrodoymeloyradøyandøyrødøymeløyaskøylurøydyrøymåsøyværøynærøyhoylandethøylandetdivtasvuodnalørenskoglorenskognesoddtangenxn--tjme-hraxn--smla-hraxn--stjrdal-s1aunjargalillehammerunjárgaxn--hamary-fyadavvenjargaxn--bearalvhki-y4a123hjemmesidegjerdrumxn--brnnysund-m8acxn--tnsberg-q1axn--mlatvuopmi-s4axn--snsa-roaxn--skierv-utaxn--brum-voatysfjordkvafjordeidfjordkvæfjordsongdalenmjondalenmjøndalenxn--gls-elackragerogáŋgaviikagangaviikasørreisasorreisasør-varangersor-varangerxn--risr-iraskiervaxn--frna-woaxn--trna-woakvinesdalleksvikleirvikrøyrvikroyrviksvelvikvenneslaevje-og-hornnessandnessjøenmarnardalvindafjordsandefjordenebakksnillfjordullensvangxn--trany-yuabrønnøysundnamsskoganaustevollxn--stjrdalshalsen-sqbnord-aurdalnord-frontrøgstadtrogstadgrimstadflakstadgjerstadxn--sandy-yuaxn--leagaviika-52bnore-og-uvdalvegarsheixn--rlingen-mxaxn--ggaviika-8ya47hvegårsheikarlsoykvitsoymasfjordenhamaroyinderoyosteroydavvenjárgasauheradguovdageaidnuxn--vre-eiker-k8abronnoysiellakkrødsheradkrodsheradkvinnheradbrønnøyxn--mtta-vrjjat-k7afxn--lrenskog-54akvitsøyvárggátkarlsøyosterøyinderøyhamarøybronnoysundxn--aurskog-hland-jnbbahccavuotnabáhccavuotnagiehtavuoatnastor-elvdalmidtre-gauldalxn--gildeskl-g0akarasjokevenassixn--bievt-0qaxn--yer-znalebesbynessebyxn--hbmer-xqamalselvmålselvxn--unjrga-rtamøre-og-romsdalmore-og-romsdalhareidmelandørlandorlandstrandålgårdsolundalgardafjordåfjorddielddanuorrikautokeinoxn--stre-toten-zcbskodjeaejriestangeliernebamblestokkefauskesnåasesnaasekongsvingerlangevagberlevagxn--flor-jrahattfjelldalostre-totenøstre-totenvestfoldxn--mely-iraálaheadjualaheadjunordreisaxn--troms-zuaxn--lgrd-poacporsangerflatangerstavangerleikangerbremangersamnangergieldakarasjohkaxn--rdy-0nabfrostautsirasnoasatromsaxn--sr-aurdal-l8aflekkefjordjølsterjolsteraremarkhedmarknååmesjevuemienaamesjevuemiexn--vard-jrarollagmeråkermerakerorskogørskogxn--bdddj-mrabdákŋoluoktaxn--osyro-wuaaknoluoktatrysilskjervøymandaljondalbindalrindalmeldalsuldalorkdalsigdalalvdallærdalhurdalsirdalverdallerdallardaloppdalåseralaseralhadselkragerødivttasvuotnaoverhallasteinkjerxn--hnefoss-q1askedsmokorsettromsøxn--dyry-iravestre-totenmuseumxn--sandnessjen-ogbrahkkeravjufylkesbiblbájddarbajddarxn--laheadju-7yarennesøyxn--koluokta-7ya57hxn--hgebostad-g3aleirfjordstorfjordbalsfjordbåtsfjordbatsfjordmuosátbievátloabátkárášjohkanøtterøyxn--mjndalen-64anordkappláhppilahppialstahaugsiljanverranrøykenroykenhaldenlyngenbergenhortenhønefosshonefosstroandinbeiarnvarggatosoyroosøyrotromsoidrettmuosatbievatruovatloabatvoagattynsetnessetxn--indery-fyaskánitskanitraholtråholtxn--ystre-slidre-ujbandebusarpsborgbearduxn--karlsy-fyahordalandjorpelandjørpelanddeatnuringsakersør-odalsor-odalxn--slt-elabringerikeaudnedalnittedalnissedalhemsedalslattumsurnadalxn--blt-elabelverumstjørdalnaustdalhjartdalgjøvikfyresdalhasviknarviklarvikgjovikmalvikgamviklenvikporsgrunnstjordalengerdaldrobakdrøbakxn--msy-ula0hvestvagoyxn--vgan-qoaxn--ryken-vuaxn--lten-graxn--stfold-9xaxn--hpmir-xqaxn--lury-iramálatvuopmimalatvuopmitysværkirkenesbirkenesmoskenesbáidárxn--fjord-lraxn--rdal-poabahcavuotnabáhcavuotnaxn--frde-gralindåsbearalvahkixn--hobl-iraráhkkerávjuxn--loabt-0qavågåáltábodøsundlundraderådeetnetimeholeauregrueoddavagavegaranatanaarnasolasulaaltalekafusavangbergkvamåmliamlibokntinnroangranosenoslobodorøstroststatåmotamotivguprivøyeroyerliermossvossxn--nvuotna-hwalusterlunnermarkerhábmerhabmerhvalerfjalerxn--rholt-mratysvarbaidarfitjargaularhápmirhapmirmelhusfosnesøksnesoksnestysneshemnesevenesflesbergeidsbergtonsbergtønsberglindasxn--sndre-land-0cbnamsosxn--srum-graøystre-slidreoystre-slidrevestre-slidretrondheimbalestrandxn--langevg-jxaaustrheimxn--skjk-soavagsoyaveroysandoykarmoyfinnoytranoyvestbytranbysykkylvenxn--hyanger-q1aspjelkavikandasuoloxn--fl-ziaxn--drbak-wuastathellexn--sr-varanger-ggbtelemarkxn--bhcavuotna-s4axn--porsgu-sta26fčáhcesuolocahcesuoloakrehamnåkrehamnsandøykarmøyfinnøytranøyvågsøyaverøynamdalseidxn--lesund-huabadaddjaxn--vegrshei-c0axn--btsfjord-9zagildeskålporsanguxn--trgstad-r1anávuotnanavuotnahammerfestxn--sgne-graxn--brnny-wuacibestadharstadnarviikaevenáššivestnesgjemnessandnesagdenesrennesoyxn--avery-yuaxn--tysvr-vrabearalváhkikongsbergspydebergrandabergxn--andy-iradavvesiidaxn--krdsherad-m8aporsáŋgufredrikstadbjerkreimringeburennebuaurskog-holandnotteroyxn--vgsy-qoa0jxn--rmskog-byaskierváivelandbyglandfrolandaurlandforsandxn--bjddar-ptamidsundålesundalesundfetsundfarsundovre-eikerøvre-eikerakershusxn--moreke-juasørfoldøstfoldostfoldsorfoldhøyangerhoyangerlevangerorkangertanangerxn--vestvgy-ixa6olillesandulsteinxn--rennesy-v1agranvinskjervoyxn--klbu-woalavagisxn--h-2faxn--ryrvik-byakafjordkåfjordseljordfolkebiblxn--gjvik-wuajevnakerxn--kfjord-iuabudejjuxn--kranghke-b0axn--davvenjrga-y4axn--rland-uuaxn--ldingen-q1axn--mlselv-iuaxn--rady-iraxn--linds-prabrumunddalxn--ygarden-p1amo-i-ranaeidskogrømskogromskoghjelmelandxn--finny-yuaxn--sr-odal-q1axn--skjervy-v1aballangenkvanangenkvænangengratangenxn--hmmrfeasta-s4acvossevangensuohkanxn--rde-ulaxn--mli-tlaxn--ksnes-uuanordlandskanlandskånlandsortlandfuoiskuxn--rros-graxn--hcesuolo-7ya35bxn--eveni-0qa01gagaivuotnagáivuotnaxn--seral-lradrammenmodalenmosjoenjan-mayentorskensteigengloppenxn--snes-poamatta-varjjatxn--sr-fron-q1aomasvuotnajessheimbådåddjåxn--krager-gyaxn--kvfjord-nxaxn--asky-iraxn--snase-nraxn--bidr-5nacholtålenxn--vads-jraxn--jlster-byamosjøenxn--rst-0nastavernxn--ostery-fyaxn--oppegrd-ixaxn--sknit-yqaxn--risa-5naoppegårdskiptvetrendalenholtalenxn--mot-tlaxn--lhppi-xqaxn--holtlen-hxaxn--srreisa-q1akopervikxn--muost-0qaxn--bmlo-grahokksundkvalsundegersundxn--karmy-yuaullensakerxn--hylandet-54axn--kvitsy-fyaxn--bod-2nalangevågberlevågkristiansandxn--rsta-frahornindalstjørdalshalsenstjordalshalsensandnessjoenhámmárfeastaxn--lrdal-srasør-fronsor-fronnord-odalkristiansundmátta-várjjatvestvågøynesoddennotoddenbuskerudøygardenoygardensalangenlavangenralingenrælingenlodingenlødingenleaŋgaviikalaakesvuemieleangaviikauenorgexn--srfold-byaaskvollxn--rskog-uuaxn--nry-yla5gxn--vry-yla5ghammarfeastaxn--rhkkervju-01afxn--givuotna-8yakommunekrokstadelvanedre-eikerhagebostadhægebostadxn--berlevg-jxakviteseidxn--s-1faxn--l-1faxn--nmesjevuemie-tcbafuosskomoårekemoarekexn--lt-liacxn--jrpeland-54asvalbardoppegardholmestrandtvedestrandsogndalsokndalarendalsunndalfolldalxn--krjohka-hwab49jlyngdaletnedalnorddalsaltdalgausdalskedsmovaksdalgjesdalstordalxn--frya-hraaarbortedrangedalxn--smna-graaurskog-hølandxn--vg-yiabtjeldsundhaugesundlindesnesxn--mre-og-romsdal-qqbxn--dnna-gradyntmpheremerseineshacknetenterprisecloudmineaccomaorimāoriorgmilcriiwigennetschoolhealthkiwigovtgeekxn--mori-qsacloudnsparliamentcomedorgcompronetedugovmuseumwebsitekinservicebarsywebsitebuildereerobookheimdnsleapcelleero-stagetechcrscsslorigingohomecdbedeeeiemesecabgngilnlalplchfisiincnnoroptatitmtltruauhulumkdkukskjplvtrgrfrkrhrusesismycynzcznetinteduassoososcloudstgbetaaezaeuhkusjshatenadiarycdn77hoptozaptois-a-knightmyftpno-ipjpnddnssdpdnsspdnsbarsysweetpepperis-a-bruinsfanis-very-sweetservegameis-a-soxfanhomelinuxcdn77-secureservebbsmisconfusedwebredirectblogsitefreedesktopcouchpotatofriestoolforgeaccesscamis-lostreadmyblogsmall-webfedorapeopleserveftpis-a-celticsfanmywirepotagertwmailin-dslsellsyourhomeread-booksfreeddnscable-modemis-savednflfanufcfanmlbfanstuff-4-saleendoftheinternetin-vpnmy-firewallhomeftpis-localis-a-chefboldlygoingnowherewebhopselfipkicks-assroxatunkcamdvrfedoraprojectgotdnsdvrdnsdyndnspubtlspimientahomeunixdontexistfedorainfracloudwmflabsfspagesbmoattachmentsteckidsfamilydsdnsaliasdynaliasnow-dnscloudnsdoomdnsduckdnsblogdnshomednsroutingthecloudendofinternetdsmynasip-dynamicpoivronhttpbinmyfirewallis-very-evilmysecuritycamerais-a-linux-userwmcloudis-a-geektuxfamilyis-a-candidatedoesntexistis-very-badhobby-sitegame-hostaltervistais-foundis-a-patsfandnsdojohepforgepodzonedynservcollegefanis-very-goodfrom-meis-very-niceisa-geeknerdpolacmedsldingorgcomnomgobabonetedupleskaemhlxmyboxrockyprvcydeuxfleurspdnscodebergheyflowstatichostorgmilcomnomgobneteduorgcomeduiorgmilcomngonetedugovcloudns1337ngrokacorggogfamcomwebgobnetedugokgopgkpgovgosbizpasaugumicsopozpapuwmwsrprusiskwpspkppspkmpspokeoiawsawifoumsdnskokwpmuppuppsppiwwiwoowuzswkzoschrzpisdnwzmiuwwitdpssewsseumigugimoirmpinbwinbwiihupporzgwgriwupowwskrwioswuozstarostwokonsulattmpccopruszkowmyspreadshopostrodakartuzyopolegminamediaustkazgorajgoraolawailawalomzawloclradombytomjaworznotargilubinkoninzagantorunkutnokepnonakloczestsopotsanokturekplockslasksklepzarowlukowmedaidgdaorgmilrelcomnomatmgsmartneteduelkgovwawsossexbiztgorysejnytychypomorzeboleslawiechomesklepsdscloudunicloudzakopanelegnicarawa-mazbydgoszczswidnikkrasnikwloclawekbielawamragowograjeworealestatebeskidykaszubymalopolskaprzeworskswiebodzinlecznadfirmaszkolawarmiagdyniamiastakazimierz-dolnymalborkswidnicadlugolekaostrolekapodlasieelblagtravelsimplesitezachpomormielecszczecinnieruchomosciwalbrzychlezajsklublinbedzinpoznanwielunmielnooleckostarachowicedkontopowiatwroclawrybniksuwalkileborkslupskgdanskostrowwlkptarnobrzegtourismwegrowkrakowglogowyou2pilanysamailwrocinfoagroautobeepshoppriviqhslapypiszlodzcfolksecommerce-shopmazurypulawyskoczowrzeszowpomorskiezgierzkaliszolkuszlowiczostrowiecsosnowiecmazowszewodzislawbialowiezazgorzeleckatowicepabianicejelenia-gorawolominkarpaczsieradznowarudaczeladzkonskowolaskierniewiceswinoujscieturystykabieszczadycieszynketrzynolsztynbialystokbabia-goraprochowicewarszawastalowa-wolapolkowicegorlicegliwiceponiatowalimanowalubartowaugustowkobierzyceopocznognieznoszczytnokolobrzegshoparenapodhalebielskoklodzkostargardatwithplayitownnamecoorgnetedugovacorgcomproestnetedugovbiznameislaprofinforechtngrokmedaaaacacpaenglawjurbarbarsykeeneticavocatacctcloudnsorgcomsecplonetedugov123paginaweborgcomnetintedugovnomepublidkinbarsygovx443cloudnsorgmilcomnetedugovcooporgmilcomschnetedugovnamecomcannetlibassoaemclantmcontstoreorgcomnomrecwwwbarsyfirminfoshopartsstackitmyddnswebspacelima-cityacincooxorgedugovbarsybrendlyhbvpsvpsspectrumlandinghostingacppmordoviamcprecbgorgmilcomspbnetintedumsknovgovbirrasmcdirmytismircloudvladimirnalchikadygeyamarinepyatigorskmyjinobashkiriaeurodirvladikavkazna4ugroznykustanaikalmykiacldmaildagestaniranbuildcloudcanvaliaravalwixdevelopmentappwritemigrationneedleverceldatabasestackitcodereplravendbonporterlovableaccoorgmilnetgovcoopmedorgcompubschnetedugovservicemecomygovorggovtvmedorgcomnetedugovinfoedgfacbmlonihkutwpsryxzbdtmacfhppmyspreadshopbrandpartiorgcomfhvpress123minsidaitcouldbeworlanbibkommunalforbundfhskiopsyskomvuxkomforbnaturbruksgymnloginlineorgcomnetedugovenscaledeuusentsurgebotdaorgmilcomnetgovnowteleporthashbangplatformlovablebarsyshopwarebasehoplixbarsyonlinemsf5gitappgitpagewawamscofigma-govcaffeinefigmacanvasoltstscwputerbarsysupportchatgptsquareomniweopensocialcpanelplaycodenotionnovecorewpsquaredpreviewjelecyonbyensrhtfastvpspieboxconvexjouwwebheyflowplatformshloginlinemadethissourcecraftclouderaorgorgcomartedugouvunivmeorgcomnetedugovsurveysstatichfheiyuxs4allprojectmyfastubervibehostapp-ionosdeployagentmecoorgcomschnetedugovbizcncostoreorgmilcomneteduembaixadaconsuladokiraranohoprincipesaotomeheliohobarsystorebaseshopwaresellfyaiabkhaziavologdamordoviapenzalenugsochinavoiexnetspbmsknovnorth-kazakhstanashgabadkareliaarmeniageorgiavladimirnalchikivanovobukharaadygeyakhakassiakalugakrasnodarjambylaktyubinsktroitskbryanskobninskkurganazerbaijanpokrovskbashkiriatselinogradvladikavkazmurmansktulatuvamangyshlaktashkentchimkentgroznykaragandatermezarkhangelskkustanaikalmykiabalashoveast-kazakhstankaracoldagestantogliattibarsyredorgcomgobedumirenknightpointaccoorgjelasticdiscoursecleverappsschacmiincogoornetonlineshopcogoorgmilcomwebnicnetintedugovbiznametestcoorgmilcomnomnetedugovorangecloudpersoindorgcomfinnatnetgovensmincomtourismintlinfox0611oyaorgmilcomnetedugovquickconnectvpnplusnettprequalifymeaddrmyaddrntdllwadlnctvavdrk12orgmilpolbeltelcomwebgennetedutskkepgovbbsbiznameinfocoorgmilcompronetedugovbiznameinfobetter-thanworse-thansakurafromdyndnson-the-webmymailerorgmilurlcomneteduidvgovmydnsgameclubebizmeneacsccogotvorhotelmilmobiinfovodteiflgplkmsmsbcckhincndnvncoztltmkckppzpdprvcvkvlvcrkrkscxuzchernovtsyrivneyaltaodesavolynrovnolutskltdinforgcomnetedugovbizvinnicazhitomirternopilpoltavakropyvnytskyizaporizhzhiasevastopolsebastopoluzhgoroduzhhorodkharkovkharkivvinnytsiakhmelnytskyizaporizhzhecrimeaodessazhytomyrnikolaevcherkassydonetskluganskluhanskkirovogradivano-frankivskchernivtsikrymkievkyivlvivsumyzakarpattiamykolaivcherkasychernigovkhersonchernihivdnipropetrovskdnepropetrovskkhmelnitskiyneacsccogoorusorgmilcomedugovmyspreadshopadimono-ipbarsybarsyonlinelayershiftnh-servretrosnubapicampaignservicelugaffinitylotteryweeklylotteryraffleentrygluglugsmeaccoindependent-inquestnimsitecopropymntltdorgplcschnetgovnhsbarsyindependent-commissionindependent-reviewpolicepublic-inquiryindependent-panelconnhospindependent-inquiryroyal-commissionoraclegovcloudappscck12libaws-govccphxcclibpvtparochchtrcck12libcceatonk12coglibtecgendstmusann-arborwashtenawcck12glghcck12sealibforksolympiabainbridge-islkeyporthoquiamyarrow-pointcentraliaport-townsendsequimport-ludlowrentonsilverdalebremertonredmondsheltonbellevueport-orchardport-angeleskingstonchehalisaberdeengig-harborseattlepoulsboidmdndsddemenegacalamaiavawapailalflnmdcncscohnhmihiviwiriinmntnmocoutvtctmtgunjokakwvnvprarorasmskstxwynykyazisadninsnngosrvis-bymircloudservernamepointtoenscaledland-4-salefreeddnsstuff-4-saleazure-apinoipdatabricksappscloudnsgolffanheliohostazurewebsitesgvorgmilcomgubneteducoorgcomnetd0egvorgmilcomnetedugovmydnsiacostoree12orgmilcomnomwebgobbibrectecnetintedugovraremprendefirminfoartseducok12orgcomnethidnsidacaiiosonlahanamhanoicamauhueorgcompronetintedugovbizbacninhtayninhhoabinhnamdinhtravinhhaiphongvinhlonghaiduongquangnamquangtrithuathienhuequangninhbacgianghaugiangquangbinhsoctrangbentrethanhphohochiminhdanangkontumhatinhkhanhhoathanhhoahealthgialailaocaiyenbaibackanngheanlonganphuyenphuthocanthodaklakdongnainameinfovinhphucdongthapkiengiangtiengiangquangngailaichaulangsonlamdongdaknonghagiangangiangcaobangbinhduongninhthuanbinhthuanbaclieuthaibinhninhbinhbinhdinhtuyenquanghungyenbaria-vungtauthainguyendienbienbinhphuocschbizputerimagine-proxyorgcomnetedugovcloud66advisormypetsdyndnsxn--8dbq2axn--4dbgdty6cxn--5dbhl8dxn--hebda8bxn--80auxn--d1atxn--c1avgxn--o1acxn--o1achxn--90azhxn--55qx5dxn--uc0atvxn--od0algxn--wcvs22dxn--gmqw5axn--mxtq1mxn--12c1fe0brxn--h3cuzk1dixn--12co0c3b4evaxn--12cfi8ixb8lxn--o3cyx2axn--m3ch0j3axn--j1adpxn--90amcxn--90a1afxn--h1ahnxn--j1ael8bxn--h1alizxn--c1avgxn--j1aefxn--80aaa0cvacxn--41acaffeineexeopentunnelbotdashtelebitorgtmaccoagricorgmilnomwebnicngonetaltedugovlawnisschoolgrondaraccoorgmilcomschnetedugovbizinfoprg1-zeropstritonstackitlimazeropsaccoorgmilgovяспборгкоммскбизмирсамаракрымсочиакодпроргобрупрצהלממשלישובאקדמיהองค์กรธุรกิจรัฐบาลศึกษาทหารเน็ต教育網絡組織公司政府個人닷넷한국澳门新闻澳門联通家電嘉里招聘通販닷컴삼성コムგეбгрфеюadcdbdgdidmdsdtdaebedeeegeiejekemenepereseveyegabacalamanauavapaqasazacfbfafgfnfpfwftfbgcgagggegkgngmgsgpgvgtgugilmlnlalclglplsltlhmimjmkmmmomambmcmdmfmgmzmpmsmtmgbbblbsbecccacnclcmcvctcscmhkhghchbhthphshlinikifigiaibicivisikninhnmncnbngnsnpnvntnjoionomobocoaofodorosotoptstttytatbtetgtithtmtltrusuvuaucueuguhulumunufjdjbjtjsjlkmkhkfkdkcktkukskpkgpmpnpkpjpgqaqmqiqsvtvcvbvmvlvrwpwtwzwbwcwawgwkwmwtrsrprgrfrercrbrarnrmrlrkrirhrwsusrssspsgsesbsaslsmsissxmxaxcxuypysylymykygybycyuztzsznzmzkzdzczbzazελευ世界台灣购物公益点看臺灣网络書籍在线网站手机机构大拿游戏信息台湾谷歌慈善商标香港中国餐厅网址中國商城食品微博政务移动集团公司八卦商店健康网店政府时尚佛山中信娱乐广东企业homedepotengineeringاماراتrepublicankuokgroupversicherungchannelcitadelxn--pgbs0dhxn--b4w605ferdstatebankwebsitexn--mgb9awbf亚马逊淡马锡alibabaxn--ngbc5azdxn--mgbbh1axn--45br5cyltoshibabuildworldcloudtradeguideplacespacedancemoviephoneprimesmilebiblestyleappleazurestoreskypegripexn--l1accdrivelottehorsehouseleasechasereisestadahondaomegaaetnaamicaninjanokiamediadeltavodkaedekaosakapizzaslingemailgmailtirolshelltmallfinallegaltotalhotelamfamforumrehabmusicciticricohcoachwatchboschearthfaithirishmiamiarchidubaiguccipraxiみんなストアセールcanonsalononionnikonepsonkoelngreensevencrownikanoradioaudioweiboglobopromogalloyahoociscorodeovideomangobingotokyovolvolottokyotophotosmartsportquesttrusthyattjetztadultcymrubaidutushuxn--kprw13dubankclickblackmerckgroupsharpcheapnowtvxn--h2brj9cקוםհայоргсрбмонкомбелмкдқазрусукрمصرقطرعربكومdadcfdmedwedredphdthdbidpidkrdmsdltdiceonewmeglemoerwecfageacbanbambaaaammakianraspacpaaxawtfbcgaegongingaigvigorgdogdhlmilrilonlaolloluoljllcalgalnflafltelsrlfrllplkimibmcamcombommomifmabbjcbscbwebcabnabtabmlbpubabcbbcnecincpncllcstcwtcpwcnyckfhbzhovhmoiskiobisbitcifyituipinvinwinxincbnbcnmanfangdnmenrenkpnmtnyunrunfununobiojioriohbogmofooboooooacoecoceongoproartistottnttbbtcateatlatvetpetbetnethktmitfitintjothotgotdotbotprueduicujnjyouinknhktdkappsapgapmapdnptopgopllpjmpzipvipripesqtrvdtvitvdevmovgovhivnrwlawsewnewbmwwownowhowdvrftrmtrsfrbarcartvscrseusawsupsubssbsadsddsldssasbmsmlsxxxboxfoxgmxtjxsextaxbuyflydiysoyjoyskypaydaygayxyzanzbizwebersenerpokerlameractortatarsolarລາວคอมไทยtourslocusnexuslexusgiftsbeatsboatspartspressglassswissकॉमनेटtiresgivescodeshomesgamestunesshoescardswalesloansvegastoolsdealsautosparisファッションworkssucksrocksxeroxforexfedexpartylillymoneystudyrugbytoraytoday中文网xn--unup4y天主教飞利浦新加坡enterprises我爱你嘉里大酒店christmasxn--fct429kholdingsxn--8y0a063axn--mgbx4cd0ablifestyleabogadoallstatenetbankكاثوليكxn--s9brj9cxn--gk3at1ebestbuycharityxn--55qx5dmicrosoftpropertybasketballhomegoodscorsicajewelrygallerygrocerysurgerycountrybrusselsverisignferreroxn--czr694bhdfcbankcommbanksoftbankپاكستانپاکستانnextdirectالسعوديهالعليانxn--h2brj9c8cxn--80adxhksshikshaxn--mgbai9azgqp6jcuisinellabarclayscatholicxn--kpry57dcompanyxn--xhq521bblackfridayxn--mgba3a3ejtsandvikxn--d1acj3bacademydownloadمليسياxn--j1amhxn--w4r85el8fhu5dnraipirangaathletaxn--fhbeixn--mgbqly7cvafrzuerichxn--c2br7gஇலங்கைcontractorsxn--io0a7igraphicsinsurancetemasekxn--xkc2al3hye2amotorcyclesphotographydirectoryplumbingxn--vhquvclothingtrainingcleaningwilliamhilllightingxn--mgba3a4f16ashoppingcateringeducationokinawapicturesventuresproductionsxn--9et52uwalmartഭാരതംsupportrealestatecapitalonexn--nqv7fs00emaauspostfloristdentistxn--qxamgodaddybradescobargainsmitsubishikerryhotelsxn--9dbq2axn--3pxu8kimmobilienxn--fjq720axn--mgbtx2bholidaymckinseymadridbusinessbuildershelsinkixn--4gbrimмоскваالسعودیةcoffeedegreelacaixapartnersalsaceofficeabbvievoyageorangegeorgeonlinechromemobilekindlegoogleoraclecircleschulesecureinsurexn--mgba7c0bbn0aestatexn--mgbc0a9azcgcruisehangoutxn--vuq861bxn--42c2d9arexrothfirestoneuniversityxn--nnx388alifeinsuranceextraspaceонлайнvermögensberatersoftwarexn--fiqs8sxn--mgbab2bdxn--w4rs40ltiendaभारतम्africatoyotaotsukasakuracameracreditcardnagoyaconsultingnetworktheatermonsterprogressivepioneerxn--55qw42gracingdatingvotingvikinglivinggivingxn--bck1b9a5dre4cbrotherweatherjoburgفلسطينlplfinancialxn--clchc0ea0b2g2a9gcdfutbolschoolsocialglobaldentalwoodsidechanelairtelmatteltravelrealtorwebcamstreamభారత్unicomalstomxn--nodexn--6frz82gmuseumfurniturexn--rvc1e0am3exn--mix891faccenturexn--11b4c3dismailineustardiscountquebeccomsecclinicservicesxn--y9a3aqxn--c1avgswatchchurchsearchالاردنmarketingcontacthealthmonashshoujisanofitaipeiamericanexpresssuzukiアマゾンクラウドポイントbhartiグーグルxn--mgberp4a5d4armemorialxn--1qqw23alondonmormoninstitutevisionbostonnortoncouponmaisonamazonvirginberlindesigndurbanolayannissananquanxihuanhitachikaufengardenreisenbayerntechnologydatsunxn--90a3aclatinocasinostudiophysioxn--ngbe9e0apharmacytattootaobaoaramcoexpertreportabbottdirectselectimamatfairwindspictettargetmarketintuittravelersinsurancecreditdupontryukyusuppliesxn--tckwebnpparibasschmidtmerckmsdyodobashirestaurantbridgestonecricketxn--fpcrj9c3dbostikbroadwayattorneylefrakemerckxn--fiq228c5hscareersfarmerswinnersflowersxn--wgbh1cguitarsxn--54b7fta0ccxn--p1acfmakeupgalluplandroverxn--kcrx77d1x4agoldpointbauhausxn--mgbayh7gpahiphopplaystationxn--mgba3a4fraxn--eckvdtc9dhyundaixn--gckr3f0fistanbulticketsmarketsflightschintaireviewsxn--3e0b707ewindowsxn--fiqz9sfinancialxn--fzys8d69uvgmابوظبيdiscoverreviewবাংলাxn--5su34j936bgsgmoscowobserverapartmentsдетиارامكوсайтeurovisionxn--i1b6b1a6a2exn--xkc2dl3a5ee0hتونسموقعبارتڀارتشبكةعمانبيتكعراقreadkredbondlandbandfundfoodprodgoldfordtubecafesafelifeggeeieeefreefagepagegugezonewinememenamegamesaleablebikenikelikecarecbreherefiresaveloveliveblueartedatesitevotecaseluxebofamodaltdaasdatiaayogasinavanashiaasiajavabbvatevavivadatazaraarpacasavisasncfprofmaifsurfgolfdvagsongbingpingwangkpmggoogblogpohlfailcooldellcalldeallidlsarlfilmteamroomfarmimdbarabclubhdfcicbchsbcgmbhrichtechfishdishcashminiernikddiaudiwikimobitaxicitikiwidesiqponskinloanakdnwienopenporncerntownimmolimoolloinfonicofidolegosaxozeroaerovivoautovotomotofastbestresthostpostnextlgbtchatseatgiftmeetdietreitmintrentgentspotscotguruitausohumenucyoubanklinkpinkdclktalksilkbookseekworkrsvpaarpjeepshopcoophelpcamppccwshowbeerstarruhrflirweirhaircarsparsjprshausplusnewstipstoysjobskidsfanspicsdocsxboxamexsexynavycitysonyarmyallybabyplaydeliverybuzzgbizlamborghiniphilipsලංකාಭಾರತfitnessexpresslanxesspfizercenterwalterlawyersoccercareerkosherbrokerlockerdealerdoctorauthorxn--mgbqly7c0a67fbcvermögensberatungjaguarxn--pssy2uxn--hxt814eflickrrepairrogersairbusxn--mgbai9a5eva00beventsyachtsxn--t60b56aভাৰতভারতभारतभारोतviajeshermeshughesxn--j1aefसंगठनvillasଭାରତclaimshotelsભારતzapposphotosjuegoscondostatamotorsgratistennisਭਾਰਤtkmaxxtjmaxxschaeffleryandexxn--80aswgrealtysafetybeautyluxuryxn--3ds443gsupplyfamilyxn--o3cw4hhockeysydneyxn--90aenissayalipayenergycomputeragencyxn--rovu88b電訊盈科xn--gecrj9cstatefarmaccountantaquarelleolayangroup香格里拉xn--p1ai组织机构xn--1ck2e1bxn--mgbt3dhdschwarzموريتانياabudhabinowruzkomatsufujitsuhospitalxn--80asehdbxn--mgbtf8flxn--j6w193gxn--yfro4i67oprudentialxn--flw351ecruisescoursesrecipesxn--e1a4cferrarixn--ses554gxn--wgbl6awatchesstaplessinglesxn--mgbcpq6gpa1axn--otu796dpropertiescreditunionxn--mgbah1a3hjkrdstockholmhisamitsuالسعوديةstcgroupdomainsoriginscouponsbloombergclubmedfroganslimitedxn--80aqecdr1aexposedinternationalequipmentbarclaycardxn--q7ce6axn--mgbi4ecexpprotectionassociatesconstructionxn--cck2b3bxn--45q11candroidfoundationישראלxn--mgbca7dzdocliniqueboutiqueengineerxn--qxa6asystemsfirmdalefashionauctionxn--nqv7finfinitirentalsreliancetradingweddingfishinghostinggentingbookingcookingxn--3hcrj9cgraingerxn--czrs0tdemocratsamsungyokohamaxn--h2breg3evexn--nyqy26alundbeckmelbournevacationssolutionsfrontierxn--vermgensberatung-pwbmanagementxn--cg4bkixn--mgb2ddeslincolnhamburgsandvikcoromantblockbusterairforcebarefootxn--4dbrk0ceinvestmentsfeedbackcommunityxn--ngbrxالبحرينdiamondsamsterdamhealthcareredumbrellaxn--mxtq1mxn--2scrj9cagakhanxn--mgbpl2fhкатоликcaravanசிங்கப்பூர்richardlimortgageamericanfamilyxn--fzc2c9e2cscholarshipssaarlandxn--imr513nvlaanderensamsclubgoodyearkitchenஇந்தியாweatherchannelallfinanzxn--kput3iالسعودیۃxn--90aisxn--efvy88hالجزائرxn--mgbaam7a8hexchangejpmorganxn--tiq49xqyjfidelitysecurityxn--mk1bu44cwanggouxn--fiq64bxn--6qq986b3xlxn--mgbbh1a71exn--80ao21amarshallsxn--5tzm5gtravelerspanasoniclatrobeyoutubeaccountantsxn--rhqv96gxn--cckwcxetdanalyticsxn--ygbi2ammxبازاربھارتسوريةorganicfreseniusسورياxn--9krt00axn--qcka1pmcxn--jlq480n2rgdeloittesciencefinancexn--jvr189mxn--30rr7yhomesensehotmailbaseballfootballleclercboehringerxn--q9jyb4cxn--mix082fاليمنهمراهpolitieسودانايرانایرانnetflixyamaxunxn--lgbbat1ad8jcollegestoragecapetowncolognekerrypropertiesxn--mgbgu82axn--ogbpf8flxn--czru2dwhoswhociprianilasallexn--g2xx48cforsalebanamexaudiblexn--vermgensberater-ctbxn--zfr164bericssonvanguardxn--45brj9cindustriestheatremarriottxn--3bst00mcomparexn--mgberp4a5d4a87gcapitaldigitalالمغربbarcelonashangrilaxn--d1alfcalvinkleinwwwcitysapporokawasakinagoyasendaikobekitakyushuyokohamackjp";
const rulesRoot = 627;
const exceptionsRoot = 631;
const numberOfNodes = nodeFlags.length;
const numberOfEdges = edgeLength.length;
const edgeOffset = new Uint32Array(numberOfEdges);
const edgeHash = new Uint32Array(numberOfEdges);
const wildcardEdge = new Int32Array(numberOfNodes).fill(-1);
for (let node2 = 0, offset = 0; node2 < numberOfNodes; node2 += 1) {
  for (let edge = edgeStart[node2]; edge < edgeStart[node2 + 1]; edge += 1) {
    edgeOffset[edge] = offset;
    const end = offset + edgeLength[edge];
    let hash2 = 5381;
    for (let i = end - 1; i >= offset; i -= 1) {
      hash2 = hash2 * 33 ^ labelText.charCodeAt(i);
    }
    edgeHash[edge] = hash2 >>> 0;
    if (edgeLength[edge] === 1 && labelText.charCodeAt(offset) === 42) {
      wildcardEdge[node2] = edge;
    }
    offset = end;
  }
}
let matchNode = -1;
let matchStart = 0;
let matchEnd = 0;
function labelEquals(edge, hostname, start, length) {
  if (edgeLength[edge] !== length) {
    return false;
  }
  const offset = edgeOffset[edge];
  for (let i = 0; i < length; i += 1) {
    if (labelText.charCodeAt(offset + i) !== hostname.charCodeAt(start + i)) {
      return false;
    }
  }
  return true;
}
function findEdge(node2, hash2, hostname, start, length) {
  let lo = edgeStart[node2];
  let hi = edgeStart[node2 + 1];
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    const value = edgeHash[mid];
    if (value < hash2) {
      lo = mid + 1;
    } else if (value > hash2) {
      hi = mid;
    } else {
      for (let e = mid; e >= lo && edgeHash[e] === hash2; e -= 1) {
        if (labelEquals(e, hostname, start, length))
          return e;
      }
      for (let e = mid + 1; e < hi && edgeHash[e] === hash2; e += 1) {
        if (labelEquals(e, hostname, start, length))
          return e;
      }
      return -1;
    }
  }
  return -1;
}
function walk(hostname, root2, allowedMask) {
  let node2 = root2;
  let end = hostname.length;
  let hash2 = 5381;
  matchNode = -1;
  for (let i = hostname.length - 1; i >= 0; i -= 1) {
    const code = hostname.charCodeAt(i);
    if (code === 46) {
      const start = i + 1;
      let edge2 = findEdge(node2, hash2 >>> 0, hostname, start, end - start);
      if (edge2 === -1) {
        edge2 = wildcardEdge[node2];
      }
      if (edge2 === -1) {
        return matchNode !== -1;
      }
      node2 = edgeChild[edge2];
      if ((nodeFlags[node2] & allowedMask) !== 0) {
        matchNode = node2;
        matchStart = start;
        matchEnd = end;
      }
      end = i;
      hash2 = 5381;
    } else {
      hash2 = hash2 * 33 ^ code;
    }
  }
  let edge = findEdge(node2, hash2 >>> 0, hostname, 0, end);
  if (edge === -1) {
    edge = wildcardEdge[node2];
  }
  if (edge !== -1) {
    node2 = edgeChild[edge];
    if ((nodeFlags[node2] & allowedMask) !== 0) {
      matchNode = node2;
      matchStart = 0;
      matchEnd = end;
    }
  }
  return matchNode !== -1;
}
function suffixLookup(hostname, options, out) {
  if (fastPathLookup(hostname, options, out)) {
    return;
  }
  const allowedMask = (options.allowPrivateDomains ? 2 : 0) | (options.allowIcannDomains ? 1 : 0);
  if (walk(hostname, exceptionsRoot, allowedMask)) {
    out.isIcann = (nodeFlags[matchNode] & 1) !== 0;
    out.isPrivate = (nodeFlags[matchNode] & 2) !== 0;
    out.publicSuffix = hostname.slice(matchEnd + 1);
    return;
  }
  if (walk(hostname, rulesRoot, allowedMask)) {
    out.isIcann = (nodeFlags[matchNode] & 1) !== 0;
    out.isPrivate = (nodeFlags[matchNode] & 2) !== 0;
    out.publicSuffix = hostname.slice(matchStart);
    return;
  }
  out.isIcann = false;
  out.isPrivate = false;
  const lastDot = hostname.lastIndexOf(".");
  out.publicSuffix = lastDot === -1 ? hostname : hostname.slice(lastDot + 1);
}
function parse(url2, options) {
  return parseImpl(url2, 5, suffixLookup, options, getEmptyResult());
}
function normalizeImportDomain(raw2) {
  const value = raw2.trim().replace(/^\.+/, "");
  if (!value || /[/\\@?#%]/.test(value) || value.includes(":") && !(value.startsWith("[") && value.endsWith("]"))) return null;
  try {
    const url2 = new URL("https://" + value + "/"), host2 = url2.hostname.toLowerCase();
    if (url2.username || url2.password || url2.port || url2.pathname !== "/" || url2.search || url2.hash || host2.endsWith(".") || host2.includes("..")) return null;
    if (node_net.isIP(host2) || host2.startsWith("[") && host2.endsWith("]") && node_net.isIP(host2.slice(1, -1)) === 6) return host2;
    const parsed = parse(host2, { allowPrivateDomains: true });
    if (parsed.domain === null && (parsed.isIcann || parsed.isPrivate)) return null;
    return host2;
  } catch {
    return null;
  }
}
function cookieDomainFamily(raw2) {
  const domain = normalizeImportDomain(raw2);
  if (!domain) return null;
  if (node_net.isIP(domain) || domain.startsWith("[")) return domain;
  return parse(domain, { allowPrivateDomains: true }).domain ?? domain;
}
const suffixes = (domain) => domain.split(".").map((_value, index2, labels) => labels.slice(index2).join("."));
function importDomainScope(domains) {
  const exact = /* @__PURE__ */ new Set(), ancestors = /* @__PURE__ */ new Set(), descendants = /* @__PURE__ */ new Set();
  for (const raw2 of domains) {
    const domain = normalizeImportDomain(raw2), boundary = cookieDomainFamily(raw2);
    if (!domain || !boundary) continue;
    exact.add(domain);
    if (domain.includes(".")) descendants.add(domain);
    for (const suffix of suffixes(domain)) {
      ancestors.add(suffix);
      if (suffix === boundary) break;
    }
  }
  return { exact, ancestors, descendants };
}
function inImportDomainScope(scope2, raw2, hostOnly) {
  const domain = normalizeImportDomain(raw2);
  if (!domain) return false;
  return scope2.exact.has(domain) || !hostOnly && scope2.ancestors.has(domain) || suffixes(domain).some((value) => scope2.descendants.has(value));
}
const bit = bigint().refine((value) => value === 0n || value === 1n);
const rowSchema = object({
  host_key: string().min(1),
  name: string(),
  value: string(),
  encrypted_value: _instanceof(Uint8Array),
  path: string().startsWith("/"),
  is_secure: bit,
  is_httponly: bit,
  expires_utc: bigint().nonnegative(),
  samesite: bigint(),
  has_expires: bit.optional(),
  top_frame_site_key: unknown().optional(),
  has_cross_site_ancestor: unknown().optional(),
  priority: bigint().optional(),
  source_scheme: bigint().optional(),
  source_port: bigint().optional()
}).passthrough();
const sites = /* @__PURE__ */ new Map([[-1n, "unspecified"], [0n, "no_restriction"], [1n, "lax"], [2n, "strict"]]);
function chromiumCookieDomain(domain) {
  const host2 = domain.replace(/^\./, ""), normalized = normalizeImportDomain(domain);
  if (!normalized || normalized !== host2.toLowerCase()) throw new BrowserCookieSourceError("source-unreadable", "来源Cookie域名无效");
  return normalized;
}
function partition(row, columns) {
  if (!columns.has("top_frame_site_key")) return null;
  if (row.top_frame_site_key === "") return null;
  if (typeof row.top_frame_site_key !== "string" || !columns.has("has_cross_site_ancestor") || row.has_cross_site_ancestor !== 0n && row.has_cross_site_ancestor !== 1n) return "unreadable";
  try {
    const site = new URL(row.top_frame_site_key);
    if (!["http:", "https:"].includes(site.protocol) || site.username || site.password || site.port || site.pathname !== "/" || site.search || site.hash || row.top_frame_site_key.trim() !== row.top_frame_site_key) return "unreadable";
    return { topLevelSite: site.origin, hasCrossSiteAncestor: row.has_cross_site_ancestor === 1n };
  } catch {
    return "unreadable";
  }
}
function cookie(row, value, key) {
  const sameSite = sites.get(row.samesite);
  if (!sameSite || /[\s=;,\u0000-\u001f\u007f]/.test(row.name) || /[\u0000-\u001f\u007f]/.test(value + row.path)) throw new BrowserCookieSourceError("source-unreadable", "来源Cookie字段校验失败");
  const secure = row.is_secure === 1n, hostOnly = !row.host_key.startsWith(".");
  if (sameSite === "no_restriction" && !secure || row.name.startsWith("__Secure-") && !secure || row.name.startsWith("__Host-") && (!secure || !hostOnly || row.path !== "/")) throw new BrowserCookieSourceError("source-unreadable", "来源Cookie安全属性无效");
  const epoch = row.expires_utc - 11644473600000000n, expirationDate = row.expires_utc === 0n || row.has_expires === 0n ? null : Number(epoch / 1000000n) + Number(epoch % 1000000n) / 1e6;
  const priorities = /* @__PURE__ */ new Map([[0n, "Low"], [1n, "Medium"], [2n, "High"]]), schemes = /* @__PURE__ */ new Map([[0n, "Unset"], [1n, "NonSecure"], [2n, "Secure"]]);
  return browserImportCookieSchema.parse({
    name: row.name,
    value,
    domain: (hostOnly ? "" : ".") + chromiumCookieDomain(row.host_key),
    path: row.path,
    secure,
    httpOnly: row.is_httponly === 1n,
    hostOnly,
    sameSite,
    expirationDate,
    partitionKey: key,
    ...row.priority === void 0 ? {} : { priority: priorities.get(row.priority) ?? "invalid" },
    ...row.source_scheme === void 0 ? {} : { sourceScheme: schemes.get(row.source_scheme) ?? "invalid" },
    ...row.source_port === void 0 ? {} : { sourcePort: Number(row.source_port) }
  });
}
async function readChromiumCookies({ databasePath, temporaryRoot, getKey }) {
  const snapshot = await snapshotChromiumCookies(databasePath, temporaryRoot);
  let db2, key;
  try {
    db2 = new Database(snapshot.path, { readonly: true, fileMustExist: true });
    db2.defaultSafeIntegers(true);
    const versionRow = object({ value: union([string(), bigint()]) }).parse(db2.prepare("SELECT value FROM meta WHERE key='version'").get()), version2 = Number(versionRow.value);
    if (!Number.isSafeInteger(version2) || version2 < 0) throw new BrowserCookieSourceError("source-unreadable", "来源Cookie库版本无效");
    const columns = new Set(array(object({ name: string() })).parse(db2.prepare("PRAGMA table_info(cookies)").all()).map((column) => column.name));
    const rows = array(rowSchema).parse(db2.prepare("SELECT * FROM cookies ORDER BY rowid").all()), cookies = [], preserveDomains = /* @__PURE__ */ new Set();
    let googleSkipped = 0, partitionSkipped = 0;
    for (const row of rows) {
      const host2 = chromiumCookieDomain(row.host_key);
      if (host2 === "google.com" || host2.endsWith(".google.com")) {
        googleSkipped++;
        continue;
      }
      const scope2 = partition(row, columns);
      if (scope2 === "unreadable") {
        partitionSkipped++;
        preserveDomains.add(host2);
        continue;
      }
      let value = row.value;
      if (row.encrypted_value.byteLength) {
        key ??= await getKey();
        value = decryptMacChromiumCookie({ encrypted: Buffer.from(row.encrypted_value), key, hostKey: row.host_key, version: version2 });
      }
      cookies.push(cookie(row, value, scope2));
    }
    return { cookies, preserveDomains: [...preserveDomains].sort(), sourceCount: rows.length, googleSkipped, partitionSkipped };
  } catch (error2) {
    if (error2 instanceof BrowserCookieSourceError) throw error2;
    throw new BrowserCookieSourceError("source-unreadable", "来源Cookie库无法读取或校验；目标登录态尚未写入");
  } finally {
    key?.fill(0);
    db2?.close();
    await snapshot.cleanup();
  }
}
const browsers = [
  { family: "chrome", label: "Google Chrome", folder: "Google/Chrome", service: "Chrome Safe Storage", account: "Chrome" },
  { family: "edge", label: "Microsoft Edge", folder: "Microsoft Edge", service: "Microsoft Edge Safe Storage", account: "Microsoft Edge" }
];
const localStateSchema = object({ profile: object({ info_cache: record(string(), object({ name: string().optional() }).passthrough()) }).passthrough() }).passthrough();
async function regular(path2, kind) {
  try {
    const s = await promises.lstat(path2);
    return !s.isSymbolicLink() && (kind === "file" ? s.isFile() : s.isDirectory());
  } catch (error2) {
    if (error2 instanceof Error && "code" in error2 && error2.code === "ENOENT") return false;
    throw new BrowserCookieSourceError("source-unreadable", "无法读取来源浏览器目录");
  }
}
function readMacBrowserCookieKey(family) {
  const browser = browsers.find((value) => value.family === family);
  if (!browser || process.platform !== "darwin") return Promise.reject(new BrowserCookieSourceError("source-unreadable", "当前平台没有所选浏览器的钥匙串读取能力"));
  return new Promise((resolve, reject) => {
    node_child_process.execFile("/usr/bin/security", ["find-generic-password", "-s", browser.service, "-a", browser.account, "-w"], { encoding: "buffer", timeout: 3e4, maxBuffer: 65536, windowsHide: true }, (error2, stdout, stderr) => {
      try {
        if (error2) throw new BrowserCookieSourceError(error2.killed ? "keychain-timeout" : "keychain-denied", error2.killed ? "等待钥匙串授权超时；未写入Cookie" : "钥匙串授权被拒绝或不可用；未写入Cookie");
        let length = stdout.length;
        if (length && stdout[length - 1] === 10) {
          length--;
          if (length && stdout[length - 1] === 13) length--;
        }
        if (!length) throw new BrowserCookieSourceError("keychain-denied", "钥匙串未返回可用口令；未写入Cookie");
        resolve(deriveMacChromiumCookieKey(stdout.subarray(0, length)));
      } catch (error22) {
        reject(error22);
      } finally {
        stdout.fill(0);
        stderr.fill(0);
      }
    });
  });
}
class BrowserCookieSources {
  constructor(options = {}) {
    this.options = options;
    this.root = options.applicationSupport ?? node_path.join(node_os.homedir(), "Library/Application Support");
  }
  selected = /* @__PURE__ */ new Map();
  root;
  async discover() {
    const result = { browsers: [] }, next = /* @__PURE__ */ new Map();
    for (const browser of browsers) {
      const directory = node_path.join(this.root, browser.folder), installed = await regular(directory, "directory"), profiles = [];
      result.browsers.push({ family: browser.family, label: browser.label, installed, profiles });
      if (!installed) continue;
      let names = {};
      try {
        const file = node_path.join(directory, "Local State");
        if (await regular(file, "file")) {
          const metadata = await promises.lstat(file);
          if (metadata.size <= 16 * 1024 * 1024) {
            const parsed = localStateSchema.safeParse(JSON.parse(await promises.readFile(file, "utf8")));
            if (parsed.success) names = parsed.data.profile.info_cache;
          }
        }
      } catch {
      }
      const entries = /* @__PURE__ */ new Set([...Object.keys(names), ...(await promises.readdir(directory)).filter((name) => name === "Default" || /^Profile \d+$/.test(name))]);
      for (const profileDirectory of [...entries].sort()) {
        if (profileDirectory !== node_path.basename(profileDirectory) || profileDirectory === "." || profileDirectory === ".." || /[\\/\u0000]/.test(profileDirectory)) continue;
        const profilePath = node_path.join(directory, profileDirectory);
        if (!await regular(profilePath, "directory")) continue;
        let cookies = null;
        const candidates = [...await regular(node_path.join(profilePath, "Network"), "directory") ? [node_path.join(profilePath, "Network/Cookies")] : [], node_path.join(profilePath, "Cookies")];
        for (const candidate of candidates) if (await regular(candidate, "file")) {
          cookies = candidate;
          break;
        }
        const id2 = node_crypto.createHash("sha256").update(JSON.stringify([browser.family, directory, profileDirectory])).digest("hex"), source = browserCookieSourceSchema.parse({ id: id2, family: browser.family, browserLabel: browser.label, profileName: names[profileDirectory]?.name || profileDirectory, profileDirectory, hasCookies: cookies !== null });
        profiles.push(source);
        next.set(id2, { source, directory: profilePath, cookies });
      }
    }
    this.selected.clear();
    for (const [id2, value] of next) this.selected.set(id2, value);
    return result;
  }
  async prepare(id2) {
    const selected = this.selected.get(id2);
    if (!selected || !await regular(selected.directory, "directory")) throw new BrowserCookieSourceError("source-missing", "所选浏览器或profile已不存在，请重新选择");
    if (!selected.cookies || !await regular(selected.cookies, "file")) throw new BrowserCookieSourceError("source-missing", "所选profile没有可读取的Cookie库");
    if (this.options.temporaryRoot) {
      await promises.mkdir(this.options.temporaryRoot, { recursive: true, mode: 448 });
      if (!await regular(this.options.temporaryRoot, "directory")) throw new BrowserCookieSourceError("source-unreadable", "导入临时目录不可用");
      await promises.chmod(this.options.temporaryRoot, 448);
    }
    const family = selected.source.family, prepared = await readChromiumCookies({ databasePath: selected.cookies, temporaryRoot: this.options.temporaryRoot, getKey: () => this.options.keychain?.(family) ?? readMacBrowserCookieKey(family) });
    return { ...prepared, source: { ...selected.source } };
  }
}
const nativeCookieSchema = object({
  name: string(),
  value: string(),
  domain: string().min(1),
  path: string(),
  secure: boolean(),
  httpOnly: boolean(),
  session: boolean(),
  expires: number().finite(),
  sameSite: _enum(["Strict", "Lax", "None"]).optional(),
  priority: _enum(["Low", "Medium", "High"]).optional(),
  sourceScheme: _enum(["Unset", "NonSecure", "Secure"]).optional(),
  sourcePort: number().int().min(-1).max(65535).optional(),
  partitionKey: unknown().optional(),
  partitionKeyOpaque: unknown().optional()
}).passthrough();
const responseSchema = object({ cookies: array(nativeCookieSchema) });
const partitionSchema = browserImportCookieSchema.shape.partitionKey.unwrap();
function decodeNativeImportCookies(value) {
  const response2 = responseSchema.parse(value);
  return response2.cookies.map((raw2) => {
    let partitionKey = null;
    if (raw2.partitionKeyOpaque === true || raw2.partitionKeyOpaque !== void 0 && typeof raw2.partitionKeyOpaque !== "boolean") return { kind: "unreadable-partition", domain: raw2.domain };
    if (raw2.partitionKey !== void 0) {
      const parsed = partitionSchema.safeParse(raw2.partitionKey);
      if (!parsed.success) return { kind: "unreadable-partition", domain: raw2.domain };
      partitionKey = parsed.data;
    }
    return { kind: "readable", cookie: browserImportCookieSchema.parse({
      name: raw2.name,
      value: raw2.value,
      domain: raw2.domain,
      path: raw2.path,
      secure: raw2.secure,
      httpOnly: raw2.httpOnly,
      hostOnly: !raw2.domain.startsWith("."),
      expirationDate: raw2.session ? null : raw2.expires,
      partitionKey,
      sameSite: raw2.sameSite === "Strict" ? "strict" : raw2.sameSite === "Lax" ? "lax" : raw2.sameSite === "None" ? "no_restriction" : "unspecified",
      ...raw2.priority === void 0 ? {} : { priority: raw2.priority },
      ...raw2.sourceScheme === void 0 ? {} : { sourceScheme: raw2.sourceScheme },
      ...raw2.sourcePort === void 0 ? {} : { sourcePort: raw2.sourcePort }
    }) };
  });
}
function nativeImportCookieParameters(input) {
  const cookie2 = browserImportCookieSchema.parse(input), url2 = new URL((cookie2.sourceScheme === "Secure" || cookie2.secure ? "https" : "http") + "://" + cookie2.domain.replace(/^\./, "") + "/");
  url2.pathname = cookie2.path;
  return {
    url: url2.href,
    name: cookie2.name,
    value: cookie2.value,
    path: cookie2.path,
    secure: cookie2.secure,
    httpOnly: cookie2.httpOnly,
    ...cookie2.hostOnly ? {} : { domain: cookie2.domain },
    ...cookie2.sameSite === "unspecified" ? {} : { sameSite: cookie2.sameSite === "strict" ? "Strict" : cookie2.sameSite === "lax" ? "Lax" : "None" },
    ...cookie2.expirationDate === null ? {} : { expires: cookie2.expirationDate },
    ...cookie2.partitionKey === null ? {} : { partitionKey: cookie2.partitionKey },
    ...cookie2.priority === void 0 ? {} : { priority: cookie2.priority },
    ...cookie2.sourceScheme === void 0 ? {} : { sourceScheme: cookie2.sourceScheme },
    ...cookie2.sourcePort === void 0 ? {} : { sourcePort: cookie2.sourcePort }
  };
}
class NativeBrowserCookieStore {
  constructor(session, view) {
    this.session = session;
    this.view = view;
  }
  get contents() {
    return this.view.webContents;
  }
  static async open(session, configure) {
    const view = new electron.WebContentsView({ webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      configure?.(view.webContents);
      await view.webContents.loadURL("about:blank");
      view.webContents.debugger.attach("1.3");
      await view.webContents.debugger.sendCommand("Network.enable");
      return new NativeBrowserCookieStore(session, view);
    } catch {
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
      throw new ApplicationError("BROWSER_UNAVAILABLE", "无法准备所选登录态的Cookie存储");
    }
  }
  async snapshot() {
    const value = await this.contents.debugger.sendCommand("Network.getAllCookies");
    return decodeNativeImportCookies(value);
  }
  async set(cookie2) {
    const value = await this.contents.debugger.sendCommand("Network.setCookie", nativeImportCookieParameters(cookie2));
    if (!object({ success: literal(true) }).safeParse(value).success) throw new ApplicationError("BROWSER_ERROR", "浏览器未确认Cookie写入");
  }
  async remove(input) {
    const cookie2 = browserImportCookieSchema.parse(input);
    await this.contents.debugger.sendCommand("Network.deleteCookies", { name: cookie2.name, domain: cookie2.domain, path: cookie2.path, ...cookie2.partitionKey === null ? {} : { partitionKey: cookie2.partitionKey } });
  }
  async flush() {
    await this.session.cookies.flushStore();
  }
  async close() {
    const contents = this.contents;
    if (contents.isDestroyed()) return;
    const closed = new Promise((resolve) => contents.once("destroyed", () => resolve()));
    if (contents.debugger.isAttached()) contents.debugger.detach();
    contents.close({ waitForBeforeUnload: false });
    await closed;
  }
}
class BrowserCookieRecoveryRequired extends ApplicationError {
  constructor(stage2) {
    super("BROWSER_UNAVAILABLE", "登录态处理尚未完成，请先重试恢复或清空该登录态");
    this.stage = stage2;
  }
}
class BrowserCookieTransactions {
  constructor(journals) {
    this.journals = journals;
  }
  active = /* @__PURE__ */ new Set();
  async exclusive(profileId, work) {
    if (this.active.has(profileId)) throw new ApplicationError("RESOURCE_BUSY", "该登录态正在导入或恢复");
    this.active.add(profileId);
    try {
      return await work();
    } finally {
      this.active.delete(profileId);
    }
  }
  async clear(journal, store) {
    let failed = 0;
    for (const change of journal.changes) {
      const cookie2 = change.after ?? change.before;
      if (!cookie2) continue;
      try {
        await store.remove(cookie2);
      } catch {
        failed++;
      }
    }
    return failed;
  }
  async restore(journal, store) {
    let failed = await this.clear(journal, store);
    for (const change of journal.changes) if (change.before) try {
      await store.set(change.before);
    } catch {
      failed++;
    }
    try {
      await store.flush();
    } catch {
      failed++;
    }
    if (failed) throw new BrowserCookieRecoveryRequired("restore");
    try {
      this.journals.remove(journal.profileId, journal.transactionId);
    } catch {
      throw new BrowserCookieRecoveryRequired("cleanup");
    }
  }
  async assertBefore(plan, store) {
    const scope2 = importDomainScope(plan.domains), actual = [];
    for (const target of await store.snapshot()) {
      const domain = target.kind === "readable" ? target.cookie.domain : target.domain, hostOnly = target.kind === "readable" ? target.cookie.hostOnly : !domain.startsWith(".");
      if (!inImportDomainScope(scope2, domain, hostOnly)) continue;
      if (target.kind !== "readable") throw new ApplicationError("RESOURCE_STATE_CHANGED", "目标Cookie分区在准备期间变化，未开始写入");
      actual.push(target.cookie);
    }
    const canonical = (cookies) => cookies.map((cookie2) => JSON.stringify(browserImportCookieSchema.parse(cookie2))).sort(), expected = plan.changes.flatMap((change) => change.before ? [change.before] : []);
    if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) throw new ApplicationError("RESOURCE_STATE_CHANGED", "目标登录态在准备期间变化，未开始写入");
  }
  apply(profileId, plan, store) {
    return this.exclusive(profileId, async () => {
      if (this.journals.read(profileId)) throw new ApplicationError("RESOURCE_BUSY", "该登录态还有待处理的恢复记录");
      if (!plan.changes.length) return { transactionId: null };
      await this.assertBefore(plan, store);
      const journal = { schemaVersion: 1, transactionId: node_crypto.randomUUID(), profileId, createdAt: Date.now(), phase: "prepared", changes: plan.changes };
      try {
        this.journals.write(journal);
      } catch (error2) {
        if (this.journals.pending().includes(profileId)) throw new BrowserCookieRecoveryRequired("journal");
        throw error2;
      }
      try {
        if (await this.clear(journal, store)) throw new ApplicationError("BROWSER_ERROR", "部分原Cookie未确认移除");
        for (const change of journal.changes) if (change.after) await store.set(change.after);
        await store.flush();
      } catch {
        await this.restore(journal, store);
        throw new ApplicationError("BROWSER_ERROR", "导入未完成，原登录态已恢复");
      }
      try {
        this.journals.commit(profileId, journal.transactionId);
      } catch {
        throw new BrowserCookieRecoveryRequired("commit");
      }
      try {
        this.journals.remove(profileId, journal.transactionId);
      } catch {
        throw new BrowserCookieRecoveryRequired("cleanup");
      }
      return { transactionId: journal.transactionId };
    });
  }
  recover(profileId, store) {
    return this.exclusive(profileId, async () => {
      const journal = this.journals.read(profileId);
      if (!journal) return "none";
      if (journal.phase === "committed") {
        try {
          this.journals.remove(profileId, journal.transactionId);
        } catch {
          throw new BrowserCookieRecoveryRequired("cleanup");
        }
        return "committed";
      }
      await this.restore(journal, store);
      return "restored";
    });
  }
}
function planBrowserCookieImport(source, target) {
  const preserve = /* @__PURE__ */ new Set();
  const requireFamily = (raw2) => {
    const family = cookieDomainFamily(raw2);
    if (!family) throw new ApplicationError("BROWSER_UNAVAILABLE", "无法确定Cookie域名边界，目标登录态尚未写入");
    return family;
  };
  for (const domain of source.preserveDomains) preserve.add(requireFamily(domain));
  const prospective = importDomainScope(source.cookies.map((cookie2) => cookie2.domain));
  for (const item of target) if (item.kind === "unreadable-partition" && inImportDomainScope(prospective, item.domain, !item.domain.startsWith("."))) preserve.add(requireFamily(item.domain));
  const incoming = source.cookies.map((cookie2) => browserImportCookieSchema.parse(cookie2)).filter((cookie2) => {
    const domain = normalizeImportDomain(cookie2.domain);
    if (domain === "google.com" || domain?.endsWith(".google.com")) throw new ApplicationError("INVALID_INPUT", "导入来源包含被排除的Google登录态");
    return !preserve.has(requireFamily(cookie2.domain));
  }), scope2 = importDomainScope(incoming.map((cookie2) => cookie2.domain));
  const originals = /* @__PURE__ */ new Map(), next = /* @__PURE__ */ new Map();
  let preservedTargetCookies = 0;
  for (const item of target) {
    if (item.kind === "unreadable-partition") {
      preservedTargetCookies++;
      continue;
    }
    const cookie2 = browserImportCookieSchema.parse(item.cookie), family = requireFamily(cookie2.domain);
    if (preserve.has(family) || !inImportDomainScope(scope2, cookie2.domain, cookie2.hostOnly)) {
      preservedTargetCookies++;
      continue;
    }
    const id2 = browserImportCookieIdentity(cookie2);
    if (originals.has(id2)) throw new ApplicationError("BROWSER_UNAVAILABLE", "目标Cookie身份重复，未开始导入");
    originals.set(id2, cookie2);
  }
  for (const cookie2 of incoming) {
    if (!normalizeImportDomain(cookie2.domain)) throw new ApplicationError("INVALID_INPUT", "来源Cookie域名无效");
    const id2 = browserImportCookieIdentity(cookie2);
    if (next.has(id2)) throw new ApplicationError("INVALID_INPUT", "来源Cookie身份重复，未开始导入");
    next.set(id2, cookie2);
  }
  const identities = /* @__PURE__ */ new Set([...originals.keys(), ...next.keys()]), changes = [...identities].map((id2) => ({ before: originals.get(id2) ?? null, after: next.get(id2) ?? null }));
  const partitionSkippedCookies = source.partitionSkipped + source.cookies.length - incoming.length;
  if (source.sourceCount !== incoming.length + source.googleSkipped + partitionSkippedCookies) throw new ApplicationError("INVALID_INPUT", "来源Cookie计数不一致，未开始导入");
  return { changes, domains: [...scope2.exact].sort(), totalCookies: source.sourceCount, importedCookies: incoming.length, skippedCookies: source.googleSkipped + partitionSkippedCookies, googleCookiesSkipped: source.googleSkipped, partitionSkippedCookies, preservedTargetCookies };
}
class BrowserImportCoordinator {
  constructor(options) {
    this.options = options;
    this.transactions = new BrowserCookieTransactions(options.journals);
    this.pending = /* @__PURE__ */ new Set([...options.journals.pending(), ...options.journals.clearing()]);
    for (const id2 of this.pending) this.state(id2, "needs-attention");
  }
  transactions;
  gates = /* @__PURE__ */ new Map();
  startup;
  pending;
  state(id2, value) {
    this.options.profiles.setImportState(id2, value);
    if (value !== "ready" && !this.gates.has(id2)) this.gates.set(id2, this.options.gate(id2));
    if (value === "ready") {
      this.gates.get(id2)?.();
      this.gates.delete(id2);
    }
    this.options.changed(id2);
  }
  initialize() {
    return this.startup ??= (async () => {
      for (const id2 of this.pending) {
        const profile = this.options.profiles.known(id2);
        if (!profile) continue;
        try {
          await this.recover(profile);
        } catch {
        }
      }
    })();
  }
  async work(profile, action, release = this.options.profiles.lock(profile.id, "导入或恢复")) {
    let store, held = false, completed = false;
    try {
      this.state(profile.id, "importing");
      await this.options.hold(profile);
      held = true;
      store = await this.options.open(profile);
      const result = await action(store);
      await store.close();
      store = void 0;
      completed = true;
      this.state(profile.id, "ready");
      return { result, reloadedPages: await this.options.resume(profile) };
    } catch (error2) {
      let closeFailed = false;
      try {
        await store?.close();
        store = void 0;
      } catch {
        closeFailed = true;
      }
      const pending = this.options.journals.pending().includes(profile.id) || this.options.journals.clearing().includes(profile.id);
      if (pending || !held || completed || closeFailed) this.state(profile.id, "needs-attention");
      else {
        this.state(profile.id, "ready");
        await this.options.resume(profile);
      }
      throw error2;
    } finally {
      try {
        await store?.close();
      } finally {
        release();
      }
    }
  }
  async import(profile, sourceId) {
    this.options.profiles.assertAvailable(profile.id);
    const release = this.options.profiles.lock(profile.id, "准备导入");
    let started = false;
    this.options.profiles.setImportState(profile.id, "importing");
    this.options.changed(profile.id);
    try {
      const prepared = await this.options.sources.prepare(sourceId);
      started = true;
      const { result, reloadedPages } = await this.work(profile, async (store) => {
        const plan = planBrowserCookieImport(prepared, await store.snapshot());
        await this.transactions.apply(profile.id, plan, store);
        this.options.profiles.setSource(profile.id, { family: prepared.source.family, profile: prepared.source.profileName, importedAt: Date.now() });
        return plan;
      }, release);
      const { changes: _, ...summary } = result;
      return { ...summary, reloadedPages };
    } finally {
      release();
      if (!started) {
        this.options.profiles.setImportState(profile.id, "ready");
        this.options.changed(profile.id);
      }
    }
  }
  async recover(profile) {
    await this.work(profile, async (store) => {
      if (this.options.journals.clearing().includes(profile.id)) {
        await this.options.clear(profile);
        this.options.profiles.setSource(profile.id, null);
        this.options.journals.finishClear(profile.id);
      } else await this.transactions.recover(profile.id, store);
    });
    this.pending.delete(profile.id);
  }
  async clear(profile) {
    await this.work(profile, async () => {
      this.options.journals.requestClear(profile.id);
      await this.options.clear(profile);
      this.options.profiles.setSource(profile.id, null);
      this.options.journals.finishClear(profile.id);
    });
    this.pending.delete(profile.id);
  }
  /** Deletion has already unloaded/closed all pages and owns its own lock. */
  async discardAfterDelete(profile) {
    this.options.journals.requestClear(profile.id);
    await this.options.clear(profile);
    this.options.journals.finishClear(profile.id);
    this.pending.delete(profile.id);
    this.state(profile.id, "ready");
  }
  assertImportable(profileId) {
    if (this.options.profiles.importState(profileId) !== "ready") throw new ApplicationError("BROWSER_UNAVAILABLE", "请先处理该登录态的恢复记录");
  }
}
class BrowserImportPagePause {
  constructor(options) {
    this.options = options;
  }
  saved = /* @__PURE__ */ new Map();
  async hold(profile) {
    const pages = this.options.pages, partition2 = this.options.session(profile);
    await awaitBrowserNavigation(pages.cancelProfileInitializations(profile.id), AbortSignal.timeout(1e4));
    let saved = this.saved.get(profile.id);
    if (!saved) {
      saved = /* @__PURE__ */ new Map();
      this.saved.set(profile.id, saved);
    }
    const targets = pages.all().filter((page) => page.profileId === profile.id);
    for (const page of targets) {
      if (!saved.has(page)) saved.set(page, this.options.address(page));
      page.importPaused = true;
      page.references.invalidate();
      const error2 = new ApplicationError("BROWSER_UNAVAILABLE", "正在导入或恢复登录态");
      page.abort.abort(error2);
      page.queue.cancelQueued(error2);
      page.contents.stop();
      this.options.changed(page.taskId);
    }
    await awaitBrowserNavigation(partition2.closeAllConnections(), AbortSignal.timeout(1e4));
    for (const page of targets) {
      if (page.closed || page.contents.isDestroyed()) continue;
      await awaitBrowserNavigation(page.proxy.send("Runtime.terminateExecution"), AbortSignal.timeout(5e3));
      await page.helper.close();
      await awaitBrowserNavigation(page.queue.settled(), AbortSignal.timeout(1e4));
      if (page.closed || page.contents.isDestroyed()) continue;
      await awaitBrowserNavigation(page.contents.loadURL("about:blank"), AbortSignal.timeout(1e4));
      if (page.contents.getURL() !== "about:blank") throw new ApplicationError("BROWSER_UNAVAILABLE", "无法暂停使用该登录态的页面，尚未写入Cookie");
    }
    await awaitBrowserNavigation(partition2.closeAllConnections(), AbortSignal.timeout(1e4));
  }
  async resume(profile) {
    const saved = this.saved.get(profile.id);
    if (!saved) return 0;
    const targets = [...saved].filter(([page]) => !page.closed && !page.contents.isDestroyed());
    await Promise.all(targets.map(async ([page, address]) => {
      try {
        await this.options.pages.resumeAfterImport(page, address, AbortSignal.timeout(25e3));
      } catch {
      }
      this.options.changed(page.taskId);
    }));
    this.saved.delete(profile.id);
    return targets.length;
  }
}
const safeStorageCipher = {
  isAvailable: () => electron.safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => electron.safeStorage.encryptString(plain),
  decrypt: (cipher2) => electron.safeStorage.decryptString(cipher2)
};
let nativeUserAgent;
const readCommands = new Set(browserCommands.filter((command) => command.semantics === "read").map((command) => command.command.slice(1).join(" ")));
const text = (value) => {
  if (!["string", "number", "boolean"].includes(typeof value)) throw new ApplicationError("INVALID_INPUT", "文本字段只接受字符串、数字或布尔值");
  return String(value);
};
class BrowserService {
  constructor(options) {
    this.options = options;
    this.settings = new BrowserSettings(options.sqlite);
    nativeUserAgent ??= electron.app.userAgentFallback;
    electron.app.userAgentFallback = browserUserAgent(nativeUserAgent, this.settings.snapshot().identity);
    this.profiles = new BrowserProfiles(options);
    this.siteStates = new BrowserSiteStates(options.sqlite, (id2) => this.profiles.all().some((profile) => profile.id === id2));
    this.permissions = new BrowserPermissions({ states: this.siteStates, available: (id2) => {
      this.profiles.assertAvailable(id2);
      return this.profiles.all().some((profile) => profile.id === id2);
    }, changed: options.changed });
    this.downloads = new BrowserDownloads({ directory: () => electron.app.getPath("downloads"), available: (id2, taskId) => {
      this.profiles.assertAvailable(id2);
      return !!options.taskProject(taskId) && this.profiles.all().some((profile) => profile.id === id2);
    }, changed: options.changed });
    this.authentication = new BrowserAuthentication({ available: (id2) => {
      this.profiles.assertAvailable(id2);
      return this.profiles.all().some((profile) => profile.id === id2);
    }, changed: options.changed });
    this.networkPolicy = new BrowserNetworkPolicy({ trusted: (id2, host2) => this.siteStates.trusted(id2, host2), failed: (contents, failure2) => {
      const page = this.pages.all().find((page2) => page2.contents === contents);
      if (!page || page.importPaused) return;
      this.certificateFailures.set(page.id, { ...failure2, challengeId: node_crypto.randomUUID() });
      this.workspace.certificateFailed(page, failure2.url, failure2.error);
    } });
    this.pages = new BrowserPageRegistry({ ...options, profiles: this.profiles, configure: (page) => {
      this.networkPolicy.install(page.contents, page.profileId);
      let displayPage = page;
      const seen = /* @__PURE__ */ new Set();
      while (displayPage.kind === "popup" && displayPage.openerPageId && !seen.has(displayPage.id)) {
        seen.add(displayPage.id);
        const parent = this.pages.all().find((value) => value.id === displayPage.openerPageId);
        if (!parent) break;
        displayPage = parent;
      }
      this.permissions.install({ contents: page.contents, taskId: page.taskId, pageId: page.id, profileId: page.profileId, displayPageId: displayPage.id });
      this.downloads.install({ contents: page.contents, taskId: page.taskId, pageId: page.id, profileId: page.profileId });
      this.authentication.install({ contents: page.contents, taskId: page.taskId, pageId: page.id, profileId: page.profileId, displayPageId: displayPage.id });
      page.contents.on("did-start-navigation", (_event, _url2, inPlace, main) => {
        if (main && !inPlace) this.certificateFailures.delete(page.id);
      });
      page.contents.once("destroyed", () => this.certificateFailures.delete(page.id));
    } });
    this.operations = new BrowserOperations(options.sqlite);
    this.operations.recover();
    this.pages.observe((event) => {
      if (event.type === "created") {
        this.conditions.set(event.page, new BrowserConditionWait(event.page));
        this.recordings.set(event.page, new BrowserRecorder(event.page));
      }
    });
    this.workspace = new BrowserWorkspace({ ...options, pages: this.pages, available: (id2) => this.profiles.assertAvailable(id2), profileState: (id2) => this.profiles.importState(id2), searchEngine: () => this.settings.snapshot().searchEngine, authentication: (taskId, pageId) => ({ prompt: this.authentication.snapshot(taskId, pageId), cancelled: this.authentication.cancelledState(taskId, pageId) }), downloads: (taskId) => this.downloads.snapshot(taskId), permission: (taskId, pageId) => this.permissions.snapshot(taskId, pageId), certificate: (id2, url2) => {
      const failure2 = this.certificateFailures.get(id2);
      if (failure2?.url === url2) return failure2;
      const page = this.pages.all().find((page2) => page2.id === id2), accepted = page ? this.networkPolicy.certificate(page.contents, url2) : null;
      return accepted ? { ...accepted, challengeId: null } : null;
    } });
    this.artifacts = new BrowserArtifacts(node_path.join(options.userData, "browser/artifacts"));
    this.cookieSources = options.cookieImport?.sources ?? new BrowserCookieSources({ temporaryRoot: node_path.join(options.userData, "browser/import-source") });
    const partition2 = (profile) => electron.session.fromPartition(profile.partition);
    const pause = new BrowserImportPagePause({ pages: this.pages, session: partition2, address: (page) => page.hostNavigation ?? this.workspace.list(page.taskId).find((tab) => tab.pageId === page.id)?.url ?? page.contents.getURL(), changed: (taskId) => options.changed?.(taskId) });
    this.imports = new BrowserImportCoordinator({
      profiles: this.profiles,
      journals: new BrowserImportJournals(options.userData, options.cookieImport?.cipher ?? safeStorageCipher),
      sources: this.cookieSources,
      open: (profile) => NativeBrowserCookieStore.open(partition2(profile), (contents) => this.networkPolicy.install(contents, profile.id)),
      hold: (profile) => pause.hold(profile),
      resume: (profile) => pause.resume(profile),
      gate: (id2) => this.networkPolicy.suspend(id2),
      clear: async (profile) => {
        const target = partition2(profile);
        await target.closeAllConnections();
        await target.clearData();
        await target.clearAuthCache();
        await target.cookies.flushStore();
        this.siteStates.forget(profile.id);
      },
      changed: (id2) => {
        for (const page of this.pages.all().filter((page2) => page2.profileId === id2)) options.changed?.(page.taskId);
      }
    });
  }
  pages;
  operations;
  workspace;
  profiles;
  settings;
  siteStates;
  networkPolicy;
  permissions;
  downloads;
  authentication;
  cookieSources;
  imports;
  certificateFailures = /* @__PURE__ */ new Map();
  artifacts;
  paused = /* @__PURE__ */ new Set();
  readWaits = /* @__PURE__ */ new Map();
  closed = false;
  conditions = /* @__PURE__ */ new WeakMap();
  recordings = /* @__PURE__ */ new WeakMap();
  reconciling;
  reconcileTimer;
  pause(taskId, value) {
    if (value) {
      this.paused.add(taskId);
      for (const page of this.pages.list(taskId)) page.queue.cancelQueued(new BrowserError("BROWSER_PAUSED", "用户已暂停浏览器，排队操作已取消"));
      for (const wait of this.readWaits.get(taskId) ?? []) wait.abort(new BrowserError("BROWSER_PAUSED", "用户已暂停浏览器"));
    } else this.paused.delete(taskId);
  }
  admit(scope2, args) {
    scope2.assertActive();
    if (this.closed) throw new BrowserError("BROWSER_UNAVAILABLE", "浏览器服务已关闭");
    if (this.options.taskProject(scope2.taskId) !== scope2.projectId || args.task !== void 0 && args.task !== scope2.taskId) throw new ApplicationError("SCOPE_DENIED", "当前运行没有这个任务的浏览器授权");
    if (this.paused.has(scope2.taskId)) throw new BrowserError("BROWSER_PAUSED", "用户已暂停浏览器");
    if (scope2.signal.aborted) throw scope2.signal.reason ?? new ApplicationError("CANCELED", "浏览器操作已取消");
  }
  async execute(scope2, command, args) {
    const timeout = args.timeout ?? 25e3, isWait = command === "wait" || command === "wait fn", budget = isWait && typeof timeout === "number" && Number.isInteger(timeout) && timeout >= 1 && timeout <= 9e4 ? timeout + 5e3 : 9e4;
    const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(new BrowserError("BROWSER_TIMEOUT", `浏览器命令等待 ${budget}ms 后超时`)), budget), signal = AbortSignal.any([scope2.signal, deadline.signal]);
    const state2 = { dispatched: () => false }, effective = { ...scope2, signal };
    try {
      return await awaitBrowserNavigation(this.executeScoped(effective, command, args, state2), signal);
    } catch (error2) {
      if (!signal.aborted) throw error2;
      const reason = signal.reason ?? error2, failure2 = reason instanceof ApplicationError ? reason : new BrowserError("BROWSER_ERROR", reason instanceof Error ? reason.message : String(reason));
      throw readCommands.has(command) || state2.dispatched() ? failure2 : applicationPreflightFailure(failure2, scope2.operationId);
    } finally {
      clearTimeout(timer);
    }
  }
  async executeScoped(scope2, command, args, state2) {
    const read = readCommands.has(command);
    let dispatched = false, receiptOwned = false, page, progress;
    state2.dispatched = () => dispatched;
    const begin = (pageId) => {
      const receipt = this.operations.begin(scope2.runId, scope2.requestId, scope2.taskId, pageId, command);
      if (!receipt.replay) receiptOwned = true;
      return receipt;
    };
    const send = () => {
      dispatched = true;
      if (!read) this.operations.update(scope2.runId, scope2.requestId, "running", "unknown", { progress });
    };
    const recordProgress = () => {
      if (!read) this.operations.update(scope2.runId, scope2.requestId, "running", "unknown", { progress });
    };
    try {
      this.admit(scope2, args);
      if (!browserCommands.some((item) => item.command.slice(1).join(" ") === command)) throw new ApplicationError("CAPABILITY_UNAVAILABLE", "浏览器命令未登记");
      if (command === "tab profile clone") {
        this.profiles.require(scope2, text(args.profile));
        throw new ApplicationError("CAPABILITY_UNAVAILABLE", "登录态完整克隆尚在开发");
      }
      if (command === "access request") throw new ApplicationError("CAPABILITY_UNAVAILABLE", "跨任务授权服务尚在开发");
      if (command === "operation get") return this.operations.receipt(scope2.runId, text(args.request));
      if (command === "identity get") {
        const value = this.settings.snapshot();
        return { result: { mode: value.identity, pendingMode: value.pendingIdentity, restartRequired: value.pendingIdentity !== null } };
      }
      if (command === "identity set") {
        const mode = browserIdentitySchema.safeParse(args.mode);
        if (!mode.success) throw new ApplicationError("INVALID_INPUT", "浏览器身份须为clean或native");
        const receipt = begin(null);
        if (receipt.replay) return { operation: this.operations.receipt(scope2.runId, scope2.requestId), replayed: true };
        const result2 = this.settings.setIdentity(mode.data, args.reset === true, send);
        this.operations.update(scope2.runId, scope2.requestId, "succeeded", "completed");
        return { result: result2 };
      }
      if (command === "tab profile list") return { result: { profiles: this.profiles.list(scope2) } };
      if (command === "tab profile create") {
        const profileScope = args.scope ?? "isolated";
        if (profileScope !== "isolated" && profileScope !== "imported") throw new ApplicationError("INVALID_INPUT", "scope须为isolated或imported");
        const receipt = begin(null);
        if (receipt.replay) return { operation: this.operations.receipt(scope2.runId, scope2.requestId), replayed: true };
        const profile = this.profiles.create(scope2, text(args.label), profileScope, send);
        this.operations.update(scope2.runId, scope2.requestId, "succeeded", "completed");
        return { result: { profile } };
      }
      if (command === "tab profile show") {
        const tab = this.workspace.list(scope2.taskId).find((tab2) => tab2.pageId === text(args.page));
        if (!tab) throw new BrowserError("BROWSER_TAB_NOT_FOUND", "没有该网页标签");
        this.profiles.ensureProject(scope2.projectId);
        const profile = this.profiles.require(scope2, tab.profileId);
        return { result: { browserPageId: tab.pageId, profileId: profile.id, profileLabel: profile.label } };
      }
      if (command === "tab profile set" || command === "tab profile use-default") {
        if (command === "tab profile set" && args.page === void 0 === (args.task === void 0)) throw new ApplicationError("INVALID_INPUT", "set须指定page或task其中一个");
        const profile = command === "tab profile use-default" ? this.profiles.ensureProject(scope2.projectId) : this.profiles.require(scope2, text(args.profile), "control");
        this.profiles.assertAvailable(profile.id);
        const tabs = this.workspace.list(scope2.taskId), targets = args.page === void 0 ? tabs.filter((tab) => tab.kind === "tab") : tabs.filter((tab) => tab.pageId === text(args.page));
        if (args.page !== void 0 && !targets.length) throw new BrowserError("BROWSER_TAB_NOT_FOUND", "没有该网页标签");
        if (targets.some((tab) => tab.kind === "popup")) throw new ApplicationError("INVALID_INPUT", "子窗口沿用来源页面登录态，请切换来源网页标签");
        const receipt = begin(null);
        if (receipt.replay) return { operation: this.operations.receipt(scope2.runId, scope2.requestId), replayed: true };
        for (const tab of targets) {
          this.profiles.assertAvailable(tab.profileId);
          await this.workspace.setProfile(scope2.taskId, tab.pageId, profile.id, () => {
            this.admit(scope2, args);
            this.profiles.assertAvailable(profile.id);
          }, send, scope2.signal);
        }
        this.operations.update(scope2.runId, scope2.requestId, "succeeded", "completed");
        return { result: { profileId: profile.id, pages: targets.map((tab) => tab.pageId) } };
      }
      if (command === "tab profile delete") {
        const profile = this.profiles.deletable(scope2, text(args.profile));
        const receipt = begin(null);
        if (receipt.replay) return { operation: this.operations.receipt(scope2.runId, scope2.requestId), replayed: true };
        const release = this.profiles.lock(profile.id, "删除");
        try {
          await this.pages.cancelProfileInitializations(profile.id);
          await this.workspace.removeProfileBindings(profile.id, (taskId) => this.profiles.ensureProject(this.options.taskProject(taskId)).id, () => this.admit(scope2, args), send);
          for (const remaining of this.pages.all().filter((page2) => page2.profileId === profile.id)) {
            if (remaining.kind !== "popup" && this.options.taskProject(remaining.taskId)) throw new ApplicationError("RESOURCE_BUSY", "仍有网页使用此登录态");
            send();
            await this.pages.close(remaining.taskId, remaining.id);
          }
          this.admit(scope2, args);
          send();
          await this.clearProfile(profile);
          this.operations.update(scope2.runId, scope2.requestId, "succeeded", "completed");
          return { result: { deleted: profile.id } };
        } finally {
          release();
        }
      }
      if (command === "tab list") return { tabs: this.workspace.list(scope2.taskId) };
      if (command === "tab show" || command === "tab current") {
        const tabs = this.workspace.list(scope2.taskId), tab = command === "tab show" ? tabs.find((tab2) => tab2.pageId === text(args.page)) : tabs.find((tab2) => tab2.active);
        if (!tab) throw new BrowserError(command === "tab show" ? "BROWSER_TAB_NOT_FOUND" : "BROWSER_NO_TAB", "没有可读取的网页标签");
        return { result: tab };
      }
      if ((command === "tab switch" || command === "tab close") && args.index !== void 0) {
        if (args.page !== void 0 || !Number.isInteger(args.index) || Number(args.index) < 0) throw new ApplicationError("INVALID_INPUT", "index与page只能指定一个，index必须是非负整数");
        const target = this.workspace.list(scope2.taskId)[Number(args.index)];
        if (!target) throw new BrowserError("BROWSER_TAB_NOT_FOUND", "标签索引不存在");
        args = { ...args, page: target.pageId };
      }
      if (command === "tab switch" && args.page === void 0) throw new ApplicationError("INVALID_INPUT", "切换标签需要index或page");
      const navigation = command === "goto" || command === "tab create" && args.url !== void 0 ? normalizeBrowserNavigationUrl(text(args.url)) : void 0;
      if (navigation === null) throw new ApplicationError("INVALID_INPUT", "导航地址或协议无效");
      if (command === "type" && Array.from(text(args.input)).length > 16384) throw new ApplicationError("INVALID_INPUT", "type 最多16384字符；长文本请改用 inserttext");
      if (command === "wait" && (args.fn !== void 0 || args.timeout !== void 0 && (!Number.isInteger(args.timeout) || Number(args.timeout) < 1 || Number(args.timeout) > 9e4))) throw new ApplicationError("INVALID_INPUT", "wait 不接受脚本，timeout须为1到90000毫秒");
      let downloadPath;
      if (command === "download") {
        const path2 = text(args.path);
        if (!path2 || path2.includes("\0")) throw new ApplicationError("INVALID_INPUT", "下载路径不能为空或含空字符");
        const cwd = this.options.taskDirectory?.(scope2.taskId);
        if (!node_path.isAbsolute(path2) && !cwd) throw new BrowserError("BROWSER_UNAVAILABLE", "任务工作目录尚未就绪");
        downloadPath = node_path.isAbsolute(path2) ? node_path.resolve(path2) : node_path.resolve(cwd, path2);
      }
      const execArgs = command === "exec" ? browserExecArguments(text(args.command)) : void 0;
      if (command === "tab create" && args.profile !== void 0) this.profiles.require(scope2, text(args.profile));
      if (command !== "tab create") page = await awaitBrowserNavigation(this.workspace.target(scope2.taskId, args.page === void 0 ? void 0 : text(args.page)), scope2.signal);
      if (command === "set credentials" && this.authentication.snapshot(scope2.taskId, page.id)) throw new ApplicationError("RESOURCE_BUSY", "页面正在等待用户处理基本认证，Agent不能代答当前提示");
      if (!read) {
        const receipt = begin(page?.id ?? null);
        if (receipt.replay) return { operation: this.operations.receipt(scope2.runId, scope2.requestId), replayed: true };
      }
      let result;
      if (command === "tab create") {
        const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(new BrowserError("BROWSER_TIMEOUT", "新建网页标签等待90000ms后超时")), 9e4), signal = AbortSignal.any([scope2.signal, deadline.signal]);
        try {
          send();
          page = await awaitBrowserNavigation(this.pages.create(scope2.taskId, scope2.projectId, void 0, args.profile === void 0 ? void 0 : text(args.profile)), signal);
          if (navigation !== void 0) await this.pages.navigate(page, navigation, signal);
          result = { pageId: page.id, url: page.contents.getURL() };
        } finally {
          clearTimeout(timer);
        }
      } else {
        const target = page;
        result = await target.queue.run(() => this.admit(scope2, args), async () => {
          const deadline = new AbortController(), budget = command === "wait" || command === "wait fn" ? Number(args.timeout ?? 25e3) + 5e3 : 9e4;
          const timer = setTimeout(() => deadline.abort(new BrowserError("BROWSER_TIMEOUT", `浏览器命令等待 ${budget}ms 后超时`)), budget);
          const signal = AbortSignal.any([scope2.signal, target.abort.signal, deadline.signal]);
          const perform = async () => {
            if (signal.aborted) throw signal.reason;
            this.profiles.assertAvailable(target.profileId);
            if (command.startsWith("cookie ")) return executeBrowserCookie(target, command, args, send);
            if (command === "set credentials") {
              this.authentication.setCredentials(target.contents, text(args.user), text(args.pass), send);
              return { result: { configured: true } };
            }
            if (command === "tab switch") {
              this.workspace.commandTarget(scope2.taskId, target.id, args.focus === true);
              send();
              return { result: { pageId: target.id, url: target.contents.getURL() } };
            }
            if (command === "tab close") {
              send();
              if (target.kind === "popup") await this.pages.close(scope2.taskId, target.id, true);
              else await this.workspace.close(scope2.taskId, target.id, true);
              return { result: { closed: target.id } };
            }
            if (command === "capture start") return { result: await this.recordings.get(target).start(send) };
            if (command === "capture stop") {
              const har = this.recordings.get(target).stop();
              send();
              return { file: await this.artifacts.write(scope2.taskId, "capture", "har", Buffer.from(JSON.stringify(har))) };
            }
            if (command === "intercept enable") {
              const patterns = args.patterns === void 0 ? [] : text(args.patterns).split(",");
              send();
              return { result: await this.recordings.get(target).enable(patterns) };
            }
            if (command === "intercept disable") {
              send();
              return { result: this.recordings.get(target).disable() };
            }
            if (command === "intercept list") return { result: this.recordings.get(target).list() };
            await target.helper.ensureSession();
            if (signal.aborted) throw signal.reason ?? new ApplicationError("CANCELED", "浏览器操作已取消");
            if (command === "download") {
              const armed = await target.references.arm(text(args.selector));
              let pending, error2;
              try {
                pending = this.downloads.expect(target.contents, downloadPath, signal);
                const dispatchDownload = () => {
                  pending.start();
                  send();
                }, actionOptions = { signal, dispatched: dispatchDownload, notStarted: () => {
                  if (!pending?.claimed()) dispatched = false;
                } };
                if (armed.hostClick) await armed.click(actionOptions);
                else await target.helper.command(["click", armed.selector], { signal, dispatched: dispatchDownload });
              } catch (e) {
                error2 = e;
              }
              try {
                const guard = await armed.finish();
                if (guard.blocked.length || !guard.connected) {
                  if (!guard.accepted.length) dispatched = pending?.claimed() ?? false;
                  throw staleReference();
                }
                if (error2) throw error2;
                if (!guard.accepted.includes("click")) throw new BrowserError("BROWSER_ERROR", "未确认下载点击事件送达；结果未知，请核对页面，不要重发");
                const downloaded = await pending.result;
                return { result: { path: downloaded.path, name: downloaded.name, bytes: downloaded.receivedBytes, downloadId: downloaded.id } };
              } catch (error22) {
                pending?.cancel(error22);
                throw error22;
              }
            }
            if (command === "goto") {
              const url2 = navigation;
              send();
              await this.pages.navigate(target, url2, signal);
              return { navigated: true };
            }
            if (command === "back" || command === "forward" || command === "reload") {
              const wc = target.contents;
              send();
              if (command === "reload") await this.pages.navigate(target, target.hostNavigation ?? wc.getURL(), signal);
              else {
                const possible = command === "back" ? wc.navigationHistory.canGoBack() : wc.navigationHistory.canGoForward();
                if (possible) {
                  await new Promise((resolve2, reject) => {
                    let settled = false;
                    const finish = (error2) => {
                      if (settled) return;
                      settled = true;
                      clearTimeout(timer2);
                      wc.off("did-finish-load", done);
                      wc.off("did-navigate-in-page", inPage);
                      wc.off("did-fail-load", failed);
                      signal.removeEventListener("abort", aborted2);
                      error2 ? reject(error2) : resolve2();
                    };
                    const done = () => finish(), failed = (_event, code, description, _url2, main) => {
                      if (main && code !== -3) finish(new BrowserError("BROWSER_ERROR", description));
                    }, aborted2 = () => finish(signal.reason);
                    const inPage = (_event, _url2, main) => {
                      if (main) finish();
                    };
                    const timer2 = setTimeout(() => finish(new BrowserError("BROWSER_TIMEOUT", "导航等待60000ms后超时")), 6e4);
                    wc.once("did-finish-load", done);
                    wc.on("did-navigate-in-page", inPage);
                    wc.on("did-fail-load", failed);
                    signal.addEventListener("abort", aborted2, { once: true });
                    if (command === "back") wc.navigationHistory.goBack();
                    else wc.navigationHistory.goForward();
                  });
                }
              }
              return { result: { url: wc.getURL(), title: wc.getTitle() } };
            }
            if (command === "snapshot") return this.artifacts.result(scope2.taskId, "snapshot", {
              ...await target.references.snapshot(target.helper, signal),
              browserPageId: target.id,
              url: target.contents.getURL(),
              title: target.contents.getTitle()
            });
            if (command === "console" || command === "network") return this.artifacts.result(scope2.taskId, command, await target.helper.command(command === "console" ? ["console"] : ["network", "requests"], { signal }));
            if (command === "exec") {
              const refIndex = execArgs.findIndex((arg) => arg.startsWith("@"));
              if (refIndex >= 0) {
                const armed = await target.references.arm(execArgs[refIndex]), native = [...execArgs];
                native[refIndex] = armed.selector;
                const actionOptions = { signal, dispatched: send, notStarted: () => {
                  dispatched = false;
                } };
                let value, error2;
                try {
                  if (execArgs[0] === "fill" && refIndex === 1) value = await armed.fill(execArgs.slice(2).join(" "), actionOptions);
                  else if (execArgs[0] === "click" && refIndex === 1 && armed.hostClick) value = await armed.click(actionOptions);
                  else value = await target.helper.command(native, { signal, dispatched: send });
                } catch (e) {
                  error2 = e;
                }
                const guard = await armed.finish();
                if (guard.blocked.length || !guard.connected) {
                  if (!guard.accepted.length) dispatched = false;
                  throw staleReference();
                }
                if (error2) throw error2;
                if (execArgs[0] === "click" && !guard.accepted.includes("click")) throw new BrowserError("BROWSER_ERROR", "未确认点击事件送达页面；结果未知，请先核对页面，勿重发");
                return this.artifacts.result(scope2.taskId, "exec", value);
              }
              return this.artifacts.result(scope2.taskId, "exec", await target.helper.command(execArgs, { signal, dispatched: send }));
            }
            if (command === "eval") {
              const expression = text(args.expression);
              let changed = false;
              const off = target.proxy.onEvent((event) => {
                const frame = event.params.frame;
                if (!event.sessionId && (event.method === "Runtime.executionContextsCleared" || event.method === "Page.frameNavigated" && typeof frame === "object" && frame !== null && !("parentId" in frame))) changed = true;
              });
              const cancel = () => {
                void target.proxy.send("Runtime.terminateExecution").catch(() => {
                });
              };
              signal.addEventListener("abort", cancel, { once: true });
              try {
                send();
                const evaluated = await target.proxy.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
                if (changed) throw new BrowserError("BROWSER_TAB_CHANGED", "执行脚本期间页面已替换");
                if (evaluated.exceptionDetails) throw new BrowserError("BROWSER_EVAL_ERROR", evaluated.exceptionDetails.text);
                if (signal.aborted) throw signal.reason ?? new ApplicationError("CANCELED", "脚本已取消");
                const value = evaluated.result.type === "undefined" ? "没有返回值" : typeof evaluated.result.value === "object" ? JSON.stringify(evaluated.result.value) : String(evaluated.result.value);
                return this.artifacts.result(scope2.taskId, "eval", { value, origin: target.contents.getURL() });
              } catch (error2) {
                if (target.closed || target.contents.isDestroyed()) throw new BrowserError("BROWSER_TAB_CLOSED", "执行脚本期间网页已关闭，结果未知");
                if (changed || error2 instanceof Error && /inspected target navigated|execution context.*destroyed/i.test(error2.message)) throw new BrowserError("BROWSER_TAB_CHANGED", "执行脚本期间页面已替换");
                throw error2;
              } finally {
                off();
                signal.removeEventListener("abort", cancel);
              }
            }
            if (command === "click" || command === "fill") {
              const ref2 = text(args.element), armed = await target.references.arm(ref2);
              let value, error2;
              const actionOptions = { signal, dispatched: send, notStarted: () => {
                dispatched = false;
              } };
              try {
                if (command === "fill") value = await armed.fill(text(args.value), actionOptions);
                else if (armed.hostClick) value = await armed.click(actionOptions);
                else value = await target.helper.command(["click", armed.selector], { signal, dispatched: send });
              } catch (e) {
                error2 = e;
              }
              const guard = await armed.finish();
              if (guard.blocked.length || !guard.connected) {
                if (!guard.accepted.length) dispatched = false;
                throw staleReference();
              }
              if (error2) throw error2;
              if (command === "click" && !guard.accepted.includes("click"))
                throw new BrowserError("BROWSER_ERROR", "未确认点击事件送达页面；结果未知，请先核对页面，勿重发");
              return value;
            }
            if (command === "type" || command === "inserttext") {
              const input = text(command === "type" ? args.input : args.text), points = Array.from(input);
              const revision = target.helper.sessionRevision;
              progress = { confirmedChars: 0 };
              const focus = await target.proxy.send("Runtime.evaluate", { expression: "document.activeElement", returnByValue: false });
              try {
                let capacity = null;
                if (focus.result.objectId) {
                  const limit = await target.proxy.send("Runtime.callFunctionOn", {
                    objectId: focus.result.objectId,
                    functionDeclaration: "function(){if(!(this instanceof HTMLInputElement||this instanceof HTMLTextAreaElement)||this.maxLength<0)return null;const selected=(this.selectionEnd??0)-(this.selectionStart??0);return Math.max(0,this.maxLength-this.value.length+selected)}",
                    returnByValue: true
                  });
                  if (typeof limit.result.value === "number" && Number.isSafeInteger(limit.result.value) && limit.result.value >= 0) capacity = limit.result.value;
                }
                for (let offset = 0; offset < points.length; offset += command === "type" ? 2e3 : points.length) {
                  if (signal.aborted) throw signal.reason;
                  await target.helper.assertInputSession(revision);
                  const chunk = points.slice(offset, offset + (command === "type" ? 2e3 : points.length));
                  progress.inFlight = { offset, length: chunk.length };
                  recordProgress();
                  try {
                    await target.helper.command(["keyboard", command === "type" ? "type" : "inserttext", chunk.join("")], { signal, dispatched: send, sessionRevision: revision });
                  } catch (error2) {
                    if (error2 instanceof BrowserInputInterrupted) delete progress.inFlight;
                    throw error2;
                  }
                  progress.confirmedChars += chunk.length;
                  delete progress.inFlight;
                  recordProgress();
                }
                if (capacity !== null && input.length > capacity) throw new BrowserError("BROWSER_ERROR", "目标maxlength可能截断本次输入；结果未知，请核对页面，不要自动重发");
                return { typed: true, progress };
              } catch (error2) {
                if (focus.result.objectId) try {
                  const observed = await target.proxy.send("Runtime.callFunctionOn", { objectId: focus.result.objectId, functionDeclaration: "function(){if(!this.isConnected)return null;if(this instanceof HTMLInputElement||this instanceof HTMLTextAreaElement)return this.value;return this.isContentEditable?this.textContent:null}", returnByValue: true });
                  if (typeof observed.result.value === "string") progress.observed = { at: (/* @__PURE__ */ new Date()).toISOString(), length: observed.result.value.length, sha256: browserDigest(observed.result.value) };
                } catch {
                }
                throw error2;
              } finally {
                if (focus.result.objectId) await target.proxy.send("Runtime.releaseObject", { objectId: focus.result.objectId }).catch(() => {
                });
              }
            }
            if (command === "wait") {
              const abort = new AbortController(), waits = this.readWaits.get(scope2.taskId) ?? /* @__PURE__ */ new Set();
              waits.add(abort);
              this.readWaits.set(scope2.taskId, waits);
              const timeout = Number(args.timeout ?? 25e3), native = ["wait"];
              if (args.selector !== void 0) native.push(text(args.selector));
              for (const key of ["text", "url", "load", "state"]) if (args[key] !== void 0) native.push("--" + key, text(args[key]));
              native.push("--timeout", String(timeout));
              const waitSignal = AbortSignal.any([signal, abort.signal]), count = ["selector", "text", "url", "load"].filter((key) => args[key] !== void 0).length;
              try {
                if (args.state !== void 0 || count > 1) return await this.conditions.get(target).run(args, waitSignal);
                if (count === 0) {
                  await target.helper.command(["wait", String(timeout)], { signal: waitSignal, timeout: timeout + 5e3 });
                  return { waited: true };
                }
                await target.helper.command(native, { signal: waitSignal, timeout: timeout + 5e3 });
                return { waited: true };
              } finally {
                waits.delete(abort);
                if (!waits.size) this.readWaits.delete(scope2.taskId);
              }
            }
            if (command === "screenshot" || command === "full-screenshot") {
              const format = args.format === "jpeg" ? "jpeg" : "png";
              const clip = command === "full-screenshot" ? (await target.proxy.send("Page.getLayoutMetrics")).cssContentSize : void 0;
              const image = await target.proxy.send("Page.captureScreenshot", { format, captureBeyondViewport: command === "full-screenshot", ...clip ? { clip: { x: 0, y: 0, width: Math.ceil(clip.width), height: Math.ceil(clip.height), scale: 1 } } : {} });
              const bytes = Buffer.from(image.data, "base64"), pixels = electron.nativeImage.createFromBuffer(bytes).getSize();
              const file = await this.artifacts.write(scope2.taskId, command, format, bytes);
              return { file, format, width: pixels.width, height: pixels.height };
            }
            if (command === "pdf") {
              const bytes = await target.contents.printToPDF({ printBackground: true, preferCSSPageSize: true });
              return { file: await this.artifacts.write(scope2.taskId, "pdf", "pdf", bytes) };
            }
            const callerTask = this.options.sqlite.prepare("SELECT cwd FROM tasks WHERE id=?").get(scope2.taskId);
            if (!callerTask) throw new BrowserError("BROWSER_UNAVAILABLE", "调用任务已不存在");
            const other = await executeBrowserPageCommand(target, command, args, { signal, cwd: callerTask.cwd, send, notStarted: () => {
              dispatched = false;
            } });
            if (other.handled) return this.artifacts.result(scope2.taskId, command.replaceAll(" ", "-"), other.result);
            throw new ApplicationError("CAPABILITY_UNAVAILABLE", "此浏览器命令尚未完成接入");
          };
          try {
            const value = await awaitBrowserNavigation(perform(), signal);
            if (signal.aborted && command !== "tab close") throw signal.reason;
            return value;
          } finally {
            clearTimeout(timer);
          }
        }, scope2.signal);
      }
      if (!read) this.operations.update(scope2.runId, scope2.requestId, "succeeded", "completed", { summary: result, progress });
      return result;
    } catch (error2) {
      let failure2 = error2 instanceof ApplicationError ? error2 : new BrowserError("BROWSER_ERROR", error2 instanceof Error ? error2.message : String(error2));
      if (page?.closed && dispatched) failure2 = new BrowserError("BROWSER_TAB_CLOSED", "执行中网页已关闭，操作结果未知");
      if (receiptOwned) this.operations.update(scope2.runId, scope2.requestId, dispatched ? "unknown" : "failed", dispatched ? "unknown" : "not-started", { progress, code: failure2.code });
      throw dispatched || read ? failure2 : applicationPreflightFailure(failure2, scope2.operationId);
    }
  }
  async clearProfile(profile) {
    await this.imports.discardAfterDelete(profile);
    this.siteStates.forget(profile.id);
    this.profiles.forget(profile.id);
  }
  /** UI-only; never part of the browser command module. Bind approval to the
   * exact outstanding failed navigation so a stale click cannot trust a new host. */
  async continueCertificate(taskId, pageId, challengeId) {
    this.workspace.snapshot(taskId);
    const page = this.pages.get(taskId, pageId), failure2 = this.certificateFailures.get(pageId);
    if (!failure2 || failure2.challengeId !== challengeId) throw new ApplicationError("RESOURCE_STATE_CHANGED", "证书提示已失效，请重试当前页面");
    this.profiles.require({ taskId, projectId: page.projectId }, page.profileId, "control");
    this.profiles.assertAvailable(page.profileId);
    this.siteStates.trust(page.profileId, failure2.host);
    this.certificateFailures.delete(pageId);
    if (page.kind === "popup") await this.pages.navigate(page, failure2.url);
    else await this.workspace.navigate(taskId, pageId, failure2.url);
  }
  profileSiteStates(taskId) {
    const { projectId } = this.workspace.snapshot(taskId);
    return this.profiles.list({ taskId, projectId }).map((profile) => ({ profile, state: this.siteStates.snapshot(profile.id), importState: this.profiles.importState(profile.id) }));
  }
  uiProfile(taskId, profileId) {
    const { projectId } = this.workspace.snapshot(taskId);
    return this.profiles.require({ taskId, projectId }, profileId, "control");
  }
  async importCookieSources(taskId) {
    this.workspace.snapshot(taskId);
    return this.cookieSources.discover();
  }
  async importCookies(taskId, profileId, sourceId) {
    const profile = this.uiProfile(taskId, profileId);
    this.imports.assertImportable(profile.id);
    return this.imports.import(profile, sourceId);
  }
  async recoverCookies(taskId, profileId) {
    await this.imports.recover(this.uiProfile(taskId, profileId));
    return this.profileSiteStates(taskId);
  }
  async clearCookies(taskId, profileId) {
    await this.imports.clear(this.uiProfile(taskId, profileId));
    return this.profileSiteStates(taskId);
  }
  revokeCertificate(taskId, profileId, host2) {
    const { projectId } = this.workspace.snapshot(taskId);
    this.profiles.require({ taskId, projectId }, profileId, "control");
    this.profiles.assertAvailable(profileId);
    this.siteStates.revokeCertificate(profileId, host2);
    for (const page of this.pages.all().filter((page2) => page2.profileId === profileId)) this.options.changed?.(page.taskId);
  }
  respondPermission(taskId, id2, allow) {
    this.workspace.snapshot(taskId);
    this.permissions.respond(taskId, id2, allow);
  }
  respondAuthentication(taskId, id2, credentials) {
    this.workspace.snapshot(taskId);
    this.authentication.respond(taskId, id2, credentials);
  }
  async retryAuthentication(taskId, pageId) {
    this.workspace.snapshot(taskId);
    const page = this.pages.get(taskId, pageId), cancelled = this.authentication.cancelledForPage(taskId, pageId);
    if (!cancelled) throw new ApplicationError("RESOURCE_STATE_CHANGED", "认证页面已变化，请重试当前页面");
    this.profiles.assertAvailable(page.profileId);
    if (page.kind === "popup") await this.pages.navigate(page, cancelled.url);
    else await this.workspace.navigate(taskId, pageId, cancelled.url);
  }
  async downloadAction(taskId, id2, action) {
    this.workspace.snapshot(taskId);
    await this.downloads.action(taskId, id2, action);
  }
  revokePermission(taskId, profileId, origin2, permission) {
    const { projectId } = this.workspace.snapshot(taskId);
    this.profiles.require({ taskId, projectId }, profileId, "control");
    this.profiles.assertAvailable(profileId);
    this.siteStates.revokePermission(profileId, origin2, permission);
    for (const page of this.pages.all().filter((page2) => page2.profileId === profileId)) this.options.changed?.(page.taskId);
  }
  async preferences(taskId) {
    this.workspace.snapshot(taskId);
    return { ...this.settings.snapshot(), downloadDirectory: electron.app.getPath("downloads"), artifactBytes: await this.artifacts.usage() };
  }
  async clearArtifacts(taskId) {
    this.workspace.snapshot(taskId);
    await this.artifacts.clear();
    return this.preferences(taskId);
  }
  /** Task completion keeps profiles. Only missing task/project owners retire a
   * partition; this also repairs cleanup interrupted by a previous App exit. */
  reconcile() {
    if (this.closed) return Promise.resolve();
    if (this.reconciling) return this.reconciling;
    this.reconciling = (async () => {
      await this.imports.initialize();
      await this.workspace.reconcile();
      let busy = false;
      for (const profile of this.profiles.all()) {
        const exists = profile.owner.kind === "task" ? this.options.taskProject(profile.owner.id) !== null : !!this.options.sqlite.prepare("SELECT 1 FROM projects WHERE id=?").get(profile.owner.id);
        if (exists) continue;
        let release;
        try {
          release = this.profiles.lock(profile.id, "清理");
        } catch (error2) {
          if (error2 instanceof ApplicationError && error2.code === "RESOURCE_BUSY") {
            busy = true;
            continue;
          }
          throw error2;
        }
        try {
          await this.pages.cancelProfileInitializations(profile.id);
          for (const page of this.pages.all().filter((page2) => page2.profileId === profile.id)) await this.pages.close(page.taskId, page.id);
          await this.clearProfile(profile);
        } finally {
          release();
        }
      }
      const recent = this.options.sqlite.prepare("SELECT key FROM app_settings WHERE key LIKE ?").all("browserRecent.v1:%");
      for (const row of recent) if (!this.options.sqlite.prepare("SELECT 1 FROM projects WHERE id=?").get(row.key.slice("browserRecent.v1:".length))) this.options.sqlite.prepare("DELETE FROM app_settings WHERE key=?").run(row.key);
      if (busy && !this.closed && !this.reconcileTimer) {
        this.reconcileTimer = setTimeout(() => {
          this.reconcileTimer = void 0;
          void this.reconcile().catch(() => console.warn("[browser] orphan-profile cleanup pending"));
        }, 250);
        this.reconcileTimer.unref();
      }
    })().finally(() => {
      this.reconciling = void 0;
    });
    return this.reconciling;
  }
  async dispose() {
    this.closed = true;
    clearTimeout(this.reconcileTimer);
    await this.reconciling;
    await this.workspace.dispose();
    this.downloads.dispose();
    await this.pages.dispose();
    this.authentication.dispose();
    this.permissions.dispose();
    this.networkPolicy.dispose();
  }
}
const response = discriminatedUnion("state", [
  object({ schema: literal(1), state: literal("running"), pid: number().int().positive().max(2147483647), startedAt: string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/) }).strict(),
  object({ schema: literal(1), state: _enum(["stopped", "unknown"]) }).strict()
]);
class MacProcessIdentityReader {
  constructor(helper) {
    this.helper = helper;
  }
  inspect(pid) {
    if (process.platform !== "darwin" || !Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) return { schema: 1, state: "unknown" };
    try {
      return response.parse(JSON.parse(node_child_process.execFileSync(this.helper, [String(pid)], { timeout: 2e3, maxBuffer: 4096, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })));
    } catch {
      return { schema: 1, state: "unknown" };
    }
  }
  read(pid) {
    const result = this.inspect(pid);
    return result.state === "running" && result.pid === pid ? { pid: result.pid, startedAt: result.startedAt } : null;
  }
  state(identity) {
    if (!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(identity.startedAt)) return "unknown";
    const result = this.inspect(identity.pid);
    if (result.state !== "running") return result.state;
    return result.pid === identity.pid && result.startedAt === identity.startedAt ? "running" : "stopped";
  }
}
const cfg = JSON.parse(node_fs.readFileSync(process.argv[2], "utf8")), root = cfg.root, raw = { group: "M12-P029", layer: "actual BrowserService/component I only", pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString(), versions: process.versions, stage: "starting", events: [], calls: [], requests: [], views: [], helperCalls: [], checks: {}, boundaries: { cipher: "synthetic AES-256-GCM constructor DI; not OS safeStorage", source: "own synthetic Chrome v24 Cookies DB and keyProvider; no real Keychain/browser", native: "actual park window transparent/nonfocus showInactive; hidden real native-opener popup; no active focus or desktop input", latch: "single actual NativeBrowserCookieStore.set completes then pauses before returning, restored in finally", notCovered: ["M11 real CLI", "UI approval A", "service-worker CookieStore residual", "real Keychain"] } };
let saveChain = Promise.resolve();
function save() {
  const bytes = JSON.stringify(raw, null, 2) + "\n";
  saveChain = saveChain.then(() => promises.writeFile(root + "/host.raw.json", bytes));
  return saveChain;
}
async function stage(name) {
  raw.stage = name;
  await save();
  process.send?.({ stage: name, pid: process.pid, at: (/* @__PURE__ */ new Date()).toISOString() });
}
const errorInfo = (e) => ({ name: e?.constructor?.name, code: e?.code ?? null, message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : void 0 });
async function call(name, args, fn) {
  const r = { name, args, at: (/* @__PURE__ */ new Date()).toISOString() };
  raw.calls.push(r);
  await save();
  try {
    const value = await fn();
    r.status = "fulfilled";
    r.value = value === void 0 ? null : value;
    return value;
  } catch (e) {
    r.status = "rejected";
    r.error = errorInfo(e);
    throw e;
  } finally {
    await save();
  }
}
const until = async (name, fn, timeout = 12e3) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw Error("Fixture completion condition timeout: " + name);
};
electron.app.setActivationPolicy("prohibited");
raw.activationPolicy = { requested: "prohibited", fulfilled: true, beforeReady: !electron.app.isReady() };
electron.app.setPath("userData", cfg.userData);
electron.app.on("browser-window-created", (_e, w) => {
  raw.events.push({ kind: "native-window-created", id: w.id });
  w.on("focus", () => {
    raw.events.push({ kind: "unexpected-window-focus", id: w.id });
    void save();
  });
});
const aes = node_crypto.randomBytes(32), chromeKey = node_crypto.randomBytes(16), keyTransfers = [], cipher = { isAvailable: () => true, encrypt: (text2) => {
  const iv = node_crypto.randomBytes(12), c = node_crypto.createCipheriv("aes-256-gcm", aes, iv);
  return Buffer.concat([iv, c.update(text2, "utf8"), c.final(), c.getAuthTag()]);
}, decrypt: (b) => {
  const d = node_crypto.createDecipheriv("aes-256-gcm", aes, b.subarray(0, 12));
  d.setAuthTag(b.subarray(-16));
  return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString("utf8");
} };
let db, service, observerA, observerB, unobserve;
let latchRelease = () => {
}, setOriginal = NativeBrowserCookieStore.prototype.set, ensureOriginal = BrowserHelper.prototype.ensureSession, commandOriginal = BrowserHelper.prototype.command;
const observedContents = /* @__PURE__ */ new Map(), heldResponses = [];
let serial = 0, importPromise;
let server, port = 0;
function track(w, kind, partition2 = "unknown") {
  if (observedContents.has(w.id)) return;
  const id2 = w.id;
  observedContents.set(id2, { contents: w, debugger: w.debugger, partition: partition2 });
  w.once("destroyed", () => raw.events.push({ kind: "contents-destroyed", id: id2 }));
  w.debugger.on("detach", (_e, reason) => raw.events.push({ kind: "debugger-detach", id: id2, reason }));
  raw.views.push({ id: id2, kind, partition: partition2 });
}
const scripts = { one: `window.p029={doc:__DOC__,tick:0,messages:[]};window.addEventListener('message',e=>{window.p029.messages.push(e.data);fetch('/message?doc='+encodeURIComponent(window.p029.doc)+'&value='+encodeURIComponent(JSON.stringify(e.data))).catch(()=>{})});setInterval(()=>{window.p029.tick++;document.cookie='liveTick='+window.p029.tick+'; SameSite=Lax; Path=/';fetch('/tick?doc='+encodeURIComponent(window.p029.doc)+'&n='+window.p029.tick).catch(()=>{})},10);`, two: `window.p029={doc:__DOC__,tick:0};`, popup: `window.p029={doc:__DOC__,tick:0};if(window.opener)window.opener.postMessage({from:'native-popup',doc:window.p029.doc},location.origin);` };
function html(which, doc) {
  const title = "P029 " + which;
  const script = scripts[which].replace("__DOC__", JSON.stringify(doc));
  return `<!doctype html><html><head><title>${title}</title><link rel="icon" href="/favicon?which=${which}"></head><body><h1>${title}</h1><input id="unsaved" value=""><script>${script}<\/script></body></html>`;
}
const js = { state: `({url:location.href,title:document.title,doc:window.p029?.doc??null,tick:window.p029?.tick??null,cookie:document.cookie,form:document.querySelector('#unsaved')?.value??null,opener:!!window.opener,openerURL:window.opener?window.opener.location.href:null,messages:window.p029?.messages??[]})`, form: `(()=>{document.querySelector('#unsaved').value='P029 unsaved value';return document.querySelector('#unsaved').value})()`, pending: `(()=>{window.p029.pending='started';fetch('/pending').then(()=>window.p029.pending='unexpected-resolved',()=>window.p029.pending='rejected');return{doc:window.p029.doc,pending:window.p029.pending}})()`, blank: `({url:location.href,title:document.title,hasOldState:!!window.p029,body:document.body?.innerText??''})` };
async function pageState(page) {
  return { id: page.id, contentsId: page.contents.id, kind: page.kind, openerPageId: page.openerPageId ?? null, profileId: page.profileId, importPaused: !!page.importPaused, abortAborted: page.abort.signal.aborted, rendererPid: page.contents.getOSProcessId(), proxyPort: Number(new URL(page.proxy.discoveryEndpoint).port), native: await page.contents.executeJavaScript(js.state), debuggerAttached: page.contents.debugger.isAttached(), helperCleanup: page.helper.cleanup ?? null };
}
const scope = (taskId) => ({ taskId, projectId: cfg.project, runId: node_crypto.randomUUID(), requestId: node_crypto.randomUUID(), operationId: node_crypto.randomUUID(), signal: new AbortController().signal, assertActive() {
} });
electron.app.whenReady().then(async () => {
  try {
    raw.initialWindows = electron.BaseWindow.getAllWindows().length;
    raw.identity = new MacProcessIdentityReader(cfg.identity).read(process.pid);
    if (process.versions.modules !== "146") throw Error("Native ABI mismatch");
    db = new Database(cfg.userData + "/p029.sqlite");
    db.exec(node_fs.readFileSync(root + "/app-settings.sql", "utf8"));
    db.exec(node_fs.readFileSync(cfg.operationsDDL, "utf8"));
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE tasks(id TEXT PRIMARY KEY, project_id TEXT NOT NULL,cwd TEXT NOT NULL)");
    db.prepare("INSERT INTO projects VALUES(?)").run(cfg.project);
    for (const id2 of cfg.tasks) db.prepare("INSERT INTO tasks VALUES(?,?,?)").run(id2, cfg.project, cfg.taskCwd);
    raw.actualSQLite = { version: db.prepare("SELECT sqlite_version() version").get(), schema: db.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name").all() };
    await promises.mkdir(cfg.support + "/Google/Chrome/Default/Network", { recursive: true, mode: 448 });
    await promises.writeFile(cfg.support + "/Google/Chrome/Local State", JSON.stringify({ profile: { info_cache: { Default: { name: "P029 synthetic Chrome" } } } }));
    const sourceDB = new Database(cfg.support + "/Google/Chrome/Default/Network/Cookies");
    sourceDB.exec(`CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY,value LONGVARCHAR);INSERT INTO meta VALUES('version','24');CREATE TABLE cookies(host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,is_secure INTEGER,is_httponly INTEGER,expires_utc INTEGER,samesite INTEGER,has_expires INTEGER,top_frame_site_key TEXT,has_cross_site_ancestor INTEGER,priority INTEGER,source_scheme INTEGER,source_port INTEGER);`);
    const sourceInsert = sourceDB.prepare("INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const [name, value] of [["X", "P029-new-X"], ["W", "P029-new-W"]]) {
      const c = node_crypto.createCipheriv("aes-128-cbc", chromeKey, Buffer.alloc(16, 32)), plain = Buffer.concat([node_crypto.createHash("sha256").update("127.0.0.1").digest(), Buffer.from(value)]), encrypted = Buffer.concat([Buffer.from("v10"), c.update(plain), c.final()]);
      sourceInsert.run("127.0.0.1", name, "", encrypted, "/", 0, 1, 0, 1, 0, "", 0, 1, 1, 80);
    }
    sourceDB.close();
    const sources = new BrowserCookieSources({ applicationSupport: cfg.support, temporaryRoot: cfg.userData + "/browser/import-source", keychain: async (family) => {
      raw.events.push({ kind: "synthetic-key-provider", family });
      const key = Buffer.from(chromeKey);
      keyTransfers.push(key);
      return key;
    } });
    service = new BrowserService({ userData: cfg.userData, sqlite: db, helper: { executable: cfg.helper, sha256: cfg.helperSha256, processes: new MacProcessIdentityReader(cfg.identity) }, taskProject: (id2) => cfg.tasks.includes(id2) ? cfg.project : null, taskDirectory: () => cfg.taskCwd, cookieImport: { sources, cipher } });
    await service.reconcile();
    unobserve = service.pages.observe((e) => {
      if (e.type === "created") track(e.page.contents, e.page.kind, service.profiles.known(e.page.profileId)?.partition);
      raw.events.push({ kind: "registry-" + e.type, pageId: e.page.id, contentsId: e.page.contents.id });
    });
    BrowserHelper.prototype.ensureSession = async function(...args) {
      raw.helperCalls.push({ method: "ensureSession", session: this.options.session, at: Date.now() });
      return ensureOriginal.apply(this, args);
    };
    BrowserHelper.prototype.command = async function(...args) {
      raw.helperCalls.push({ method: "command", session: this.options.session, args: args[0], at: Date.now() });
      return commandOriginal.apply(this, args);
    };
    const profileA = service.profiles.create({ taskId: cfg.tasks[0], projectId: cfg.project }, "P029 import A"), profileB = service.profiles.create({ taskId: cfg.tasks[1], projectId: cfg.project }, "P029 isolated B"), sa = electron.session.fromPartition(profileA.partition), sb = electron.session.fromPartition(profileB.partition);
    raw.profiles = { a: profileA, b: profileB };
    observerA = await NativeBrowserCookieStore.open(sa, (w) => track(w, "observer-A", profileA.partition));
    observerB = await NativeBrowserCookieStore.open(sb, (w) => track(w, "observer-B", profileB.partition));
    const cookie2 = (name, value) => ({ name, value, domain: "127.0.0.1", path: "/", hostOnly: true, secure: false, httpOnly: true, sameSite: "lax", expirationDate: null, partitionKey: null, priority: "Medium", sourceScheme: "NonSecure", sourcePort: 80 });
    for (const c of [cookie2("X", "P029-old-X"), cookie2("Y", "P029-old-Y"), { ...cookie2("Z", "P029-keep-Z"), domain: "other.example.test" }]) await observerA.set(c);
    await observerB.set(cookie2("B", "P029-isolated-B"));
    await observerA.flush();
    await observerB.flush();
    raw.cookiesSeedA = await observerA.snapshot();
    raw.cookiesSeedB = await observerB.snapshot();
    server = node_http.createServer((req, res) => {
      const url2 = new URL(req.url, "http://127.0.0.1"), r = { id: ++serial, method: req.method, path: url2.pathname, query: Object.fromEntries(url2.searchParams), at: Date.now(), closed: false, completed: false };
      raw.requests.push(r);
      res.once("finish", () => {
        r.completed = true;
      });
      res.once("close", () => {
        r.closed = true;
        r.closedAt = Date.now();
        r.destroyed = res.destroyed;
      });
      if (["/one", "/two", "/popup"].includes(url2.pathname)) {
        const which = url2.pathname.slice(1), doc = which + "-" + r.id;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(html(which, doc));
      } else if (url2.pathname === "/pending") {
        heldResponses.push(res);
      } else if (url2.pathname === "/favicon") {
        res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#146b62"/></svg>');
      } else {
        res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
        res.end("P029 fixture");
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
    raw.fixture = { host: "127.0.0.1", port, origin: "http://127.0.0.1:" + port };
    process.send?.({ ready: true, pid: process.pid, port, activationPolicy: raw.activationPolicy });
    const pages = [];
    for (const path2 of ["/one", "/two"]) {
      const state2 = service.workspace.create(cfg.tasks[0]), id2 = state2.activeId;
      await service.workspace.setProfile(cfg.tasks[0], id2, profileA.id, () => {
      }, () => {
      });
      await service.workspace.navigate(cfg.tasks[0], id2, raw.fixture.origin + path2);
      const p = service.pages.get(cfg.tasks[0], id2);
      await until("page fixture " + path2, async () => await p.contents.executeJavaScript("!!window.p029"));
      pages.push(p);
    }
    raw.formBefore = await pages[1].contents.executeJavaScript(js.form);
    const popupExpression = "(()=>{window.open(" + JSON.stringify(raw.fixture.origin + "/popup") + ',"p029-native-popup");return true})()';
    raw.dynamicExpressions = [popupExpression];
    await pages[0].contents.executeJavaScript(popupExpression, true);
    const popup = await until("native named popup", () => service.pages.all().find((p) => p.kind === "popup"));
    await until("native popup document", async () => await popup.contents.executeJavaScript("!!window.p029"));
    pages.push(popup);
    await until("favicon persistence", () => {
      const tabs = service.workspace.snapshot(cfg.tasks[0]).tabs;
      return tabs.length === 2 && tabs.every((t) => t.favicon !== null && t.title.startsWith("P029 "));
    });
    await until("cookie-writing page runs", async () => (await pages[0].contents.executeJavaScript(js.state)).tick >= 8);
    raw.before = { pages: await Promise.all(pages.map(pageState)), workspace: service.workspace.snapshot(cfg.tasks[0]), persisted: db.prepare("SELECT key,value FROM app_settings WHERE key=?").get("browserWorkspace.v1:" + cfg.tasks[0]), cookiesA: await observerA.snapshot(), cookiesB: await observerB.snapshot(), windows: electron.BaseWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), focused: w.isFocused(), visible: w.isVisible(), focusable: w.isFocusable(), opacity: "getOpacity" in w ? w.getOpacity() : null })), helperCalls: raw.helperCalls.length };
    await pages[0].contents.executeJavaScript(js.pending);
    await until("real pending HTTP accepted", () => raw.requests.some((r) => r.path === "/pending"));
    const list = await call("service.importCookieSources", { task: cfg.tasks[0] }, () => service.importCookieSources(cfg.tasks[0]));
    raw.sourceSelection = list;
    const source = list.browsers.find((b) => b.family === "chrome")?.profiles[0];
    if (!source) throw Error("Synthetic source discovery precondition failed");
    let enteredResolve = () => {
    };
    const entered = new Promise((r) => enteredResolve = r), released = new Promise((r) => latchRelease = r);
    let latched = false;
    NativeBrowserCookieStore.prototype.set = async function(value) {
      await setOriginal.call(this, value);
      if (!latched && value.name === "W" && value.value === "P029-new-W") {
        latched = true;
        NativeBrowserCookieStore.prototype.set = setOriginal;
        raw.events.push({ kind: "latch-enter-after-real-set", cookie: { name: value.name, value: value.value }, at: Date.now() });
        await save();
        enteredResolve();
        await released;
        raw.events.push({ kind: "latch-release", at: Date.now() });
      }
    };
    await stage("import-dispatch");
    importPromise = call("service.importCookies", { taskId: cfg.tasks[0], profileId: profileA.id, sourceId: source.id }, () => service.importCookies(cfg.tasks[0], profileA.id, source.id));
    await Promise.race([entered, importPromise.then(() => {
      throw Error("Import finished without expected single set latch");
    }), new Promise((_, reject) => setTimeout(() => reject(Error("Import latch wait timeout")), 3e4))]);
    await stage("import-latched");
    const during = { at: Date.now(), pages: [], requestsCountBefore: raw.requests.length, helperCallsBefore: raw.helperCalls.length, profileState: service.profiles.importState(profileA.id), workspace: service.workspace.snapshot(cfg.tasks[0]), persisted: db.prepare("SELECT key,value FROM app_settings WHERE key=?").get("browserWorkspace.v1:" + cfg.tasks[0]), cookiesA: await observerA.snapshot(), cookiesB: await observerB.snapshot() };
    raw.during = during;
    for (const p of pages) during.pages.push({ id: p.id, contentsId: p.contents.id, kind: p.kind, openerPageId: p.openerPageId ?? null, importPaused: !!p.importPaused, abortAborted: p.abort.signal.aborted, url: p.contents.getURL(), blank: await p.contents.executeJavaScript(js.blank), debuggerAttached: p.contents.debugger.isAttached(), helperCleanup: p.helper.cleanup ?? null });
    const ticks = () => raw.requests.filter((r) => r.path === "/tick").length;
    during.oldTickCounts = { start: ticks() };
    await new Promise((r) => setTimeout(r, 180));
    during.oldTickCounts.end = ticks();
    during.cookiesAAfterObservation = await observerA.snapshot();
    during.pending = structuredClone(raw.requests.filter((r) => r.path === "/pending"));
    for (const [id2, sess] of [["A", sa], ["B", sb]]) {
      try {
        during["fetch" + id2] = { status: "fulfilled", text: await (await sess.fetch(raw.fixture.origin + "/gate-probe?session=" + id2)).text() };
      } catch (e) {
        during["fetch" + id2] = { status: "rejected", error: errorInfo(e) };
      }
    }
    during.requestsAfterGateProbes = raw.requests.filter((r) => r.path === "/gate-probe");
    for (const [command, args] of [["get title", { page: pages[0].id }], ["tab profile delete", { profile: profileA.id }]]) {
      const s = scope(cfg.tasks[0]), record2 = { command, args, scope: { taskId: s.taskId, projectId: s.projectId, runId: s.runId, requestId: s.requestId, operationId: s.operationId } };
      try {
        record2.result = await service.execute(s, command, args);
        record2.status = "fulfilled";
      } catch (e) {
        record2.status = "rejected";
        record2.error = errorInfo(e);
      }
      if (command === "get title") during.command = record2;
      else during.deleteProfile = record2;
    }
    during.helperCallsAfter = raw.helperCalls.length;
    during.cookiesBAfter = await observerB.snapshot();
    during.nativeMetrics = electron.app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type }));
    await save();
    latchRelease();
    raw.importResult = await importPromise;
    await stage("import-resumed");
    await until("all original documents reloaded", async () => {
      const states = await Promise.all(pages.map((p) => p.contents.executeJavaScript(js.state)));
      return states.every((s, i) => s.url === raw.before.pages[i].native.url && s.doc && s.doc !== raw.before.pages[i].native.doc);
    }, 3e4);
    await until("new opener receives real popup message", async () => {
      const s = await pages[0].contents.executeJavaScript(js.state);
      return s.messages.some((m) => m.from === "native-popup" && m.doc !== raw.before.pages[2].native.doc);
    });
    raw.after = { pages: await Promise.all(pages.map(pageState)), workspace: service.workspace.snapshot(cfg.tasks[0]), persisted: db.prepare("SELECT key,value FROM app_settings WHERE key=?").get("browserWorkspace.v1:" + cfg.tasks[0]), cookiesA: await observerA.snapshot(), cookiesB: await observerB.snapshot(), profileState: service.profiles.importState(profileA.id), profileMetadata: service.profiles.known(profileA.id), journals: node_fs.existsSync(cfg.userData + "/browser/import-journal/" + profileA.id + ".bin"), keyProviderTransfersErased: keyTransfers.map((b) => b.every((n) => n === 0)), helperCalls: raw.helperCalls.length };
    await stage("source-failure-closed");
    const failureBefore = { cookies: await observerB.snapshot(), requests: raw.requests.length, profile: service.profiles.importState(profileB.id) };
    try {
      await service.importCookies(cfg.tasks[1], profileB.id, "f".repeat(64));
      raw.failureClosed = { status: "fulfilled", before: failureBefore };
    } catch (e) {
      raw.failureClosed = { status: "rejected", error: errorInfo(e), before: failureBefore, after: { cookies: await observerB.snapshot(), profile: service.profiles.importState(profileB.id), requestCount: raw.requests.length } };
    }
    raw.completed = true;
  } catch (e) {
    raw.failure = errorInfo(e);
    process.send?.({ failed: true, stage: raw.stage, error: raw.failure });
  } finally {
    latchRelease();
    NativeBrowserCookieStore.prototype.set = setOriginal;
    BrowserHelper.prototype.ensureSession = ensureOriginal;
    BrowserHelper.prototype.command = commandOriginal;
    raw.hooksRestored = { set: NativeBrowserCookieStore.prototype.set === setOriginal, ensure: BrowserHelper.prototype.ensureSession === ensureOriginal, command: BrowserHelper.prototype.command === commandOriginal };
    await stage("cleanup");
    if (importPromise) await Promise.race([importPromise.catch(() => {
    }), new Promise((r) => setTimeout(r, 35e3))]);
    raw.cleanupBefore = { metrics: electron.app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type })), windows: electron.BaseWindow.getAllWindows().map((w) => w.id), pages: service?.pages.all().map((p) => ({ id: p.id, contentsId: p.contents.id, proxyPort: Number(new URL(p.proxy.discoveryEndpoint).port), socketDirectory: p.helper.options.sockets, session: p.helper.options.session })) ?? [] };
    unobserve?.();
    try {
      await observerA?.close();
      await observerB?.close();
      await service?.dispose();
    } catch (e) {
      raw.cleanupError = errorInfo(e);
    }
    for (const res of heldResponses) res.destroy();
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r()));
    }
    for (const c of observedContents.values()) if (!c.contents.isDestroyed()) c.contents.close({ waitForBeforeUnload: false });
    await until("owned contents destroyed", () => [...observedContents.values()].every((c) => c.contents.isDestroyed()), 7e3).catch((e) => raw.cleanupWaitError = String(e));
    raw.cleanupAfter = { windows: electron.BaseWindow.getAllWindows().map((w) => w.id), contents: [...observedContents].map(([id2, c]) => ({ id: id2, destroyed: c.contents.isDestroyed(), debuggerAttached: c.debugger.isAttached() })), allRemaining: electron.webContents.getAllWebContents().map((w) => ({ id: w.id, url: w.getURL() })), serverListening: server?.listening ?? false };
    db?.close();
    chromeKey.fill(0);
    aes.fill(0);
    raw.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    await stage("done");
    await save();
    process.send?.({ done: true, pid: process.pid, completed: !!raw.completed, cleanup: raw.cleanupAfter });
    electron.app.exit(raw.completed && !raw.cleanupError ? 0 : 1);
  }
});
