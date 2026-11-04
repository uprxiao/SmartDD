"use strict";
const electron = require("electron");
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path$1 = require("node:path");
const http = require("node:http");
const https = require("node:https");
const node_crypto = require("node:crypto");
var zod = {};
var external = {};
var core$1 = {};
var core = {};
var util = {};
var hasRequiredUtil;
function requireUtil() {
  if (hasRequiredUtil) return util;
  hasRequiredUtil = 1;
  (function(exports2) {
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CONSTANT_CATCH = exports2.Class = exports2.BIGINT_FORMAT_RANGES = exports2.NUMBER_FORMAT_RANGES = exports2.primitiveTypes = exports2.propertyKeyTypes = exports2.getParsedType = exports2.allowsEval = exports2.captureStackTrace = void 0;
    exports2.assertEqual = assertEqual;
    exports2.assertNotEqual = assertNotEqual;
    exports2.toZod = toZod;
    exports2.assertIs = assertIs;
    exports2.assertNever = assertNever;
    exports2.assert = assert;
    exports2.getEnumValues = getEnumValues;
    exports2.joinValues = joinValues;
    exports2.jsonStringifyReplacer = jsonStringifyReplacer;
    exports2.cached = cached;
    exports2.nullish = nullish;
    exports2.cleanRegex = cleanRegex;
    exports2.floatSafeRemainder = floatSafeRemainder;
    exports2.defineLazy = defineLazy;
    exports2.objectClone = objectClone;
    exports2.assignProp = assignProp;
    exports2.rawShape = rawShape;
    exports2.mergeDefs = mergeDefs;
    exports2.cloneDef = cloneDef;
    exports2.getElementAtPath = getElementAtPath;
    exports2.promiseAllObject = promiseAllObject;
    exports2.randomString = randomString;
    exports2.esc = esc;
    exports2.slugify = slugify;
    exports2.isObject = isObject;
    exports2.isPlainObject = isPlainObject;
    exports2.shallowClone = shallowClone;
    exports2.numKeys = numKeys;
    exports2.escapeRegex = escapeRegex;
    exports2.clone = clone;
    exports2.normalizeParams = normalizeParams;
    exports2.createTransparentProxy = createTransparentProxy;
    exports2.stringifyPrimitive = stringifyPrimitive;
    exports2.optionalKeys = optionalKeys;
    exports2.pick = pick;
    exports2.omit = omit;
    exports2.extend = extend;
    exports2.safeExtend = safeExtend;
    exports2.merge = merge;
    exports2.partial = partial;
    exports2.required = required;
    exports2.aborted = aborted;
    exports2.explicitlyAborted = explicitlyAborted;
    exports2.prefixIssues = prefixIssues;
    exports2.unwrapMessage = unwrapMessage;
    exports2.sizeCaps = sizeCaps;
    exports2.attachSchema = attachSchema;
    exports2.finalizeIssue = finalizeIssue;
    exports2.getSizableOrigin = getSizableOrigin;
    exports2.codePointLength = codePointLength;
    exports2.getLengthableOrigin = getLengthableOrigin;
    exports2.parsedType = parsedType;
    exports2.issue = issue;
    exports2.cleanEnum = cleanEnum;
    exports2.base64ToUint8Array = base64ToUint8Array;
    exports2.uint8ArrayToBase64 = uint8ArrayToBase64;
    exports2.base64urlToUint8Array = base64urlToUint8Array;
    exports2.uint8ArrayToBase64url = uint8ArrayToBase64url;
    exports2.hexToUint8Array = hexToUint8Array;
    exports2.uint8ArrayToHex = uint8ArrayToHex;
    exports2.members = members;
    exports2.own = own;
    exports2.hide = hide;
    exports2.derived = derived;
    exports2.defineLazyInternal = defineLazyInternal;
    exports2.installLazyProp = installLazyProp;
    exports2.constantCatch = constantCatch;
    const core_js_1 = /* @__PURE__ */ requireCore$1();
    function assertEqual(val) {
      return val;
    }
    function assertNotEqual(val) {
      return val;
    }
    function toZod() {
      return (schema) => schema;
    }
    function assertIs(_arg) {
    }
    function assertNever(_x) {
      throw new Error("Unexpected value in exhaustive check");
    }
    function assert(_) {
    }
    function getEnumValues(entries) {
      const numericValues = Object.values(entries).filter((v) => typeof v === "number");
      const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
      return values;
    }
    function joinValues(array, separator = "|") {
      return array.map((val) => stringifyPrimitive(val)).join(separator);
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
    const EVALUATING = /* @__PURE__ */ Symbol("evaluating");
    function defineLazy(object, key, getter) {
      let value = void 0;
      Object.defineProperty(object, key, {
        get() {
          if (value === EVALUATING) {
            return void 0;
          }
          if (value === void 0) {
            value = EVALUATING;
            value = getter();
          }
          return value;
        },
        set(v) {
          Object.defineProperty(object, key, {
            value: v
            // configurable: true,
          });
        },
        configurable: true
      });
    }
    function objectClone(obj) {
      return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
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
    function mirrorShape(target, source, keys, wrap) {
      const raw2 = sourceShape(source);
      for (const key of keys) {
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
    function cloneDef(schema) {
      return mergeDefs(schema._zod.def);
    }
    function getElementAtPath(obj, path2) {
      if (!path2)
        return obj;
      return path2.reduce((acc, key) => acc?.[key], obj);
    }
    function promiseAllObject(promisesObj) {
      const keys = Object.keys(promisesObj);
      const promises = keys.map((key) => promisesObj[key]);
      return Promise.all(promises).then((results) => {
        const resolvedObj = {};
        for (let i = 0; i < keys.length; i++) {
          resolvedObj[keys[i]] = results[i];
        }
        return resolvedObj;
      });
    }
    function randomString(length = 10) {
      const chars = "abcdefghijklmnopqrstuvwxyz";
      let str = "";
      for (let i = 0; i < length; i++) {
        str += chars[Math.floor(Math.random() * chars.length)];
      }
      return str;
    }
    function esc(str) {
      return JSON.stringify(str);
    }
    function slugify(input) {
      return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
    }
    exports2.captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
    };
    function isObject(data2) {
      return typeof data2 === "object" && data2 !== null && !Array.isArray(data2);
    }
    exports2.allowsEval = cached(() => {
      if (core_js_1.globalConfig.jitless) {
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
    function numKeys(data2) {
      let keyCount = 0;
      for (const key in data2) {
        if (Object.prototype.hasOwnProperty.call(data2, key)) {
          keyCount++;
        }
      }
      return keyCount;
    }
    const getParsedType = (data2) => {
      const t = typeof data2;
      switch (t) {
        case "undefined":
          return "undefined";
        case "string":
          return "string";
        case "number":
          return Number.isNaN(data2) ? "nan" : "number";
        case "boolean":
          return "boolean";
        case "function":
          return "function";
        case "bigint":
          return "bigint";
        case "symbol":
          return "symbol";
        case "object":
          if (Array.isArray(data2)) {
            return "array";
          }
          if (data2 === null) {
            return "null";
          }
          if (data2.then && typeof data2.then === "function" && data2.catch && typeof data2.catch === "function") {
            return "promise";
          }
          if (typeof Map !== "undefined" && data2 instanceof Map) {
            return "map";
          }
          if (typeof Set !== "undefined" && data2 instanceof Set) {
            return "set";
          }
          if (typeof Date !== "undefined" && data2 instanceof Date) {
            return "date";
          }
          if (typeof File !== "undefined" && data2 instanceof File) {
            return "file";
          }
          return "object";
        default:
          throw new Error(`Unknown data type: ${t}`);
      }
    };
    exports2.getParsedType = getParsedType;
    exports2.propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
    exports2.primitiveTypes = /* @__PURE__ */ new Set([
      "string",
      "number",
      "bigint",
      "boolean",
      "symbol",
      "undefined"
    ]);
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
    function createTransparentProxy(getter) {
      let target;
      return new Proxy({}, {
        get(_, prop, receiver) {
          target ?? (target = getter());
          return Reflect.get(target, prop, receiver);
        },
        set(_, prop, value, receiver) {
          target ?? (target = getter());
          return Reflect.set(target, prop, value, receiver);
        },
        has(_, prop) {
          target ?? (target = getter());
          return Reflect.has(target, prop);
        },
        deleteProperty(_, prop) {
          target ?? (target = getter());
          return Reflect.deleteProperty(target, prop);
        },
        ownKeys(_) {
          target ?? (target = getter());
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(_, prop) {
          target ?? (target = getter());
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
        defineProperty(_, prop, descriptor) {
          target ?? (target = getter());
          return Reflect.defineProperty(target, prop, descriptor);
        }
      });
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
    exports2.NUMBER_FORMAT_RANGES = (() => ({
      safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      int32: [-2147483648, 2147483647],
      uint32: [0, 4294967295],
      float32: [-34028234663852886e22, 34028234663852886e22],
      float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
    }))();
    exports2.BIGINT_FORMAT_RANGES = {
      int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
      uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
    };
    function pick(schema, mask) {
      const currDef = schema._zod.def;
      const checks2 = currDef.checks;
      const hasChecks = checks2 && checks2.length > 0;
      if (hasChecks) {
        throw new Error(".pick() cannot be used on object schemas containing refinements");
      }
      const newShape = {};
      mirrorShape(newShape, schema, maskedKeys(schema, mask));
      return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
    }
    function maskedKeys(schema, mask) {
      const raw2 = sourceShape(schema);
      const keys = [];
      for (const key of Reflect.ownKeys(mask)) {
        if (!Object.getOwnPropertyDescriptor(raw2, key)?.enumerable) {
          throw new Error(`Unrecognized key: "${String(key)}"`);
        }
        if (mask[key])
          keys.push(key);
      }
      return keys;
    }
    function omit(schema, mask) {
      const currDef = schema._zod.def;
      const checks2 = currDef.checks;
      const hasChecks = checks2 && checks2.length > 0;
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
      const checks2 = schema._zod.def.checks;
      const hasChecks = checks2 && checks2.length > 0;
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
    function partial(Class2, schema, mask, name = "partial") {
      const currDef = schema._zod.def;
      const checks2 = currDef.checks;
      const hasChecks = checks2 && checks2.length > 0;
      if (hasChecks) {
        throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
      }
      const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
      const newShape = {};
      mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class2 && ((value, key) => selected && !selected.has(key) ? value : new Class2({ type: "optional", innerType: value })));
      return clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
    }
    function required(Class2, schema, mask) {
      const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
      const newShape = {};
      mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => (
        // overwrite with non-optional
        selected && !selected.has(key) ? value : new Class2({ type: "nonoptional", innerType: value })
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
        var _a;
        (_a = iss).path ?? (_a.path = []);
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
      var _a;
      for (let i = start; i < issues.length; i++) {
        (_a = issues[i]).schema ?? (_a.schema = inst);
      }
    }
    function finalizeIssue(iss, ctx, config2) {
      var _a;
      const traits = iss.inst?._zod?.traits;
      if (traits?.has("$ZodType")) {
        if (traits.has("$ZodCheck"))
          (_a = iss).schema ?? (_a.schema = iss.inst);
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
    function getSizableOrigin(input) {
      if (input instanceof Set)
        return "set";
      if (input instanceof Map)
        return "map";
      if (input instanceof File)
        return "file";
      return "unknown";
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
    function parsedType(data2) {
      const t = typeof data2;
      switch (t) {
        case "number": {
          return Number.isNaN(data2) ? "nan" : "number";
        }
        case "object": {
          if (data2 === null) {
            return "null";
          }
          if (Array.isArray(data2)) {
            return "array";
          }
          const obj = data2;
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
    function cleanEnum(obj) {
      return Object.entries(obj).filter(([k, _]) => {
        return Number.isNaN(Number.parseInt(k, 10));
      }).map((el2) => el2[1]);
    }
    function base64ToUint8Array(base64) {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }
    function uint8ArrayToBase64(bytes) {
      let binaryString = "";
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
      }
      return btoa(binaryString);
    }
    function base64urlToUint8Array(base64url) {
      const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
      const padding = "=".repeat((4 - base64.length % 4) % 4);
      return base64ToUint8Array(base64 + padding);
    }
    function uint8ArrayToBase64url(bytes) {
      return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }
    function hexToUint8Array(hex) {
      const cleanHex = hex.replace(/^0x/, "");
      if (cleanHex.length % 2 !== 0) {
        throw new Error("Invalid hex string length");
      }
      const bytes = new Uint8Array(cleanHex.length / 2);
      for (let i = 0; i < cleanHex.length; i += 2) {
        bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
      }
      return bytes;
    }
    function uint8ArrayToHex(bytes) {
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    class Class {
      constructor(..._args) {
      }
    }
    exports2.Class = Class;
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
    exports2.CONSTANT_CATCH = "~constantCatch";
    function constantCatch(value) {
      const fn = () => value;
      fn[exports2.CONSTANT_CATCH] = true;
      return fn;
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(util);
  return util;
}
var hasRequiredCore$1;
function requireCore$1() {
  if (hasRequiredCore$1) return core;
  hasRequiredCore$1 = 1;
  (function(exports2) {
    var _a;
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.globalConfig = exports2.$ZodEncodeError = exports2.$ZodAsyncError = exports2.$brand = exports2.NEVER = void 0;
    exports2.$constructor = $constructor;
    exports2.config = config2;
    const util_js_1 = /* @__PURE__ */ requireUtil();
    exports2.NEVER = Object.freeze({
      status: "aborted"
    });
    const _zodDesc = { value: void 0, enumerable: false };
    let _E = "captureStackTrace" in Error ? Error : null;
    function newError(Definition) {
      const E = _E;
      if (E) {
        const saved2 = E.stackTraceLimit;
        if (typeof saved2 === "number") {
          try {
            E.stackTraceLimit = 0;
          } catch {
            _E = null;
            return new Definition();
          }
          try {
            return new Definition();
          } finally {
            E.stackTraceLimit = saved2;
          }
        }
      }
      return new Definition();
    }
    function $constructor(name, initializer, proto, params) {
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
        initializer(inst, def);
        if (initialized) {
          const own = Object.getPrototypeOf(inst);
          const ctorProto = inst._zod.constr.prototype;
          let up = own;
          while (up && up !== ctorProto)
            up = Object.getPrototypeOf(up);
          const target = up ?? own;
          if (!initialized.has(target)) {
            initialized.add(target);
            (0, util_js_1.members)(target, protoMembers);
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
    exports2.$brand = Symbol("zod_brand");
    class $ZodAsyncError extends Error {
      constructor() {
        super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
      }
    }
    exports2.$ZodAsyncError = $ZodAsyncError;
    class $ZodEncodeError extends Error {
      constructor(name) {
        super(`Encountered unidirectional transform during encode: ${name}`);
        this.name = "ZodEncodeError";
      }
    }
    exports2.$ZodEncodeError = $ZodEncodeError;
    (_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
    exports2.globalConfig = globalThis.__zod_globalConfig;
    function config2(newConfig) {
      if (newConfig)
        Object.assign(exports2.globalConfig, newConfig);
      return exports2.globalConfig;
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(core);
  return core;
}
var parse$1 = {};
var errors$1 = {};
var hasRequiredErrors$1;
function requireErrors$1() {
  if (hasRequiredErrors$1) return errors$1;
  hasRequiredErrors$1 = 1;
  (function(exports2) {
    var __createBinding = errors$1 && errors$1.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = errors$1 && errors$1.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = errors$1 && errors$1.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.$ZodRealError = exports2.$ZodError = void 0;
    exports2.flattenError = flattenError;
    exports2.formatError = formatError;
    exports2.treeifyError = treeifyError;
    exports2.toDotPath = toDotPath;
    exports2.prettifyError = prettifyError;
    const core_js_1 = /* @__PURE__ */ requireCore$1();
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    function _getMessage() {
      const internals = this._zod;
      internals.message ?? (internals.message = JSON.stringify(internals.def, util2.jsonStringifyReplacer, 2));
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
    const initializer = (inst, def) => {
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
    exports2.$ZodError = (0, core_js_1.$constructor)("$ZodError", initializer);
    exports2.$ZodRealError = (0, core_js_1.$constructor)("$ZodError", initializer, void 0, {
      Parent: Error
    });
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
    function flattenError(error, mapper = (issue) => issue.message) {
      const fieldErrors = {};
      const formErrors = [];
      for (const sub of error.issues) {
        if (sub.path.length > 0) {
          node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
        } else {
          formErrors.push(mapper(sub));
        }
      }
      return { formErrors, fieldErrors };
    }
    function formatError(error, mapper = (issue) => issue.message) {
      const fieldErrors = { _errors: [] };
      const processError = (error2, path2 = []) => {
        for (const issue of error2.issues) {
          if (issue.code === "invalid_union" && issue.errors.length) {
            issue.errors.map((issues) => processError({ issues }, [...path2, ...issue.path]));
          } else if (issue.code === "invalid_key") {
            processError({ issues: issue.issues }, [...path2, ...issue.path]);
          } else if (issue.code === "invalid_element") {
            processError({ issues: issue.issues }, [...path2, ...issue.path]);
          } else {
            const fullpath = [...path2, ...issue.path];
            if (fullpath.length === 0) {
              fieldErrors._errors.push(mapper(issue));
            } else {
              let curr = fieldErrors;
              let i = 0;
              while (i < fullpath.length) {
                const el2 = fullpath[i];
                const terminal = i === fullpath.length - 1;
                if (el2 === "_errors") {
                  if (terminal)
                    curr._errors.push(mapper(issue));
                  i++;
                  continue;
                }
                if (!Object.prototype.hasOwnProperty.call(curr, el2)) {
                  Object.defineProperty(curr, el2, {
                    value: { _errors: [] },
                    enumerable: true,
                    writable: true,
                    configurable: true
                  });
                }
                const node2 = curr[el2];
                if (terminal) {
                  node2._errors.push(mapper(issue));
                }
                curr = node2;
                i++;
              }
            }
          }
        }
      };
      processError(error);
      return fieldErrors;
    }
    function treeifyError(error, mapper = (issue) => issue.message) {
      const result = { errors: [] };
      const processError = (error2, path2 = []) => {
        var _a;
        for (const issue of error2.issues) {
          if (issue.code === "invalid_union" && issue.errors.length) {
            issue.errors.map((issues) => processError({ issues }, [...path2, ...issue.path]));
          } else if (issue.code === "invalid_key") {
            processError({ issues: issue.issues }, [...path2, ...issue.path]);
          } else if (issue.code === "invalid_element") {
            processError({ issues: issue.issues }, [...path2, ...issue.path]);
          } else {
            const fullpath = [...path2, ...issue.path];
            if (fullpath.length === 0) {
              result.errors.push(mapper(issue));
              continue;
            }
            let curr = result;
            let i = 0;
            while (i < fullpath.length) {
              const el2 = fullpath[i];
              const terminal = i === fullpath.length - 1;
              if (typeof el2 === "string") {
                curr.properties ?? (curr.properties = {});
                if (!Object.prototype.hasOwnProperty.call(curr.properties, el2)) {
                  Object.defineProperty(curr.properties, el2, {
                    value: { errors: [] },
                    enumerable: true,
                    writable: true,
                    configurable: true
                  });
                }
                curr = curr.properties[el2];
              } else {
                curr.items ?? (curr.items = []);
                (_a = curr.items)[el2] ?? (_a[el2] = { errors: [] });
                curr = curr.items[el2];
              }
              if (terminal) {
                curr.errors.push(mapper(issue));
              }
              i++;
            }
          }
        }
      };
      processError(error);
      return result;
    }
    function toDotPath(_path) {
      const segs = [];
      const path2 = _path.map((seg) => typeof seg === "object" ? seg.key : seg);
      for (const seg of path2) {
        if (typeof seg === "number")
          segs.push(`[${seg}]`);
        else if (typeof seg === "symbol")
          segs.push(`[${JSON.stringify(String(seg))}]`);
        else if (/[^\w$]/.test(seg))
          segs.push(`[${JSON.stringify(seg)}]`);
        else {
          if (segs.length)
            segs.push(".");
          segs.push(seg);
        }
      }
      return segs.join("");
    }
    function prettifyError(error) {
      const lines = [];
      const issues = [...error.issues].sort((a, b) => (a.path ?? []).length - (b.path ?? []).length);
      for (const issue of issues) {
        lines.push(`✖ ${issue.message}`);
        if (issue.path?.length)
          lines.push(`  → at ${toDotPath(issue.path)}`);
      }
      return lines.join("\n");
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(errors$1);
  return errors$1;
}
var hasRequiredParse$1;
function requireParse$1() {
  if (hasRequiredParse$1) return parse$1;
  hasRequiredParse$1 = 1;
  (function(exports2) {
    var __createBinding = parse$1 && parse$1.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = parse$1 && parse$1.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = parse$1 && parse$1.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.safeDecodeAsync = exports2._safeDecodeAsync = exports2.safeEncodeAsync = exports2._safeEncodeAsync = exports2.safeDecode = exports2._safeDecode = exports2.safeEncode = exports2._safeEncode = exports2.decodeAsync = exports2._decodeAsync = exports2.encodeAsync = exports2._encodeAsync = exports2.decode = exports2._decode = exports2.encode = exports2._encode = exports2.validateAsync = exports2.validate = exports2.safeParseAsync = exports2._safeParseAsync = exports2.safeParse = exports2._safeParse = exports2.parseAsync = exports2._parseAsync = exports2.parse = exports2._parse = void 0;
    const core2 = __importStar(/* @__PURE__ */ requireCore$1());
    const errors2 = __importStar(/* @__PURE__ */ requireErrors$1());
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    function finalizeParams(callee, params) {
      return { callee: params?.callee ?? callee, Err: params?.Err };
    }
    const _parse = (_Err) => {
      const fn = (schema, value, _ctx, _params) => {
        const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
        const result = schema._zod.run({ value, issues: [] }, ctx);
        if (result instanceof Promise) {
          throw new core2.$ZodAsyncError();
        }
        if (result.issues.length) {
          const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config())));
          util2.captureStackTrace(e, _params?.callee ?? fn);
          throw e;
        }
        return result.value;
      };
      return fn;
    };
    exports2._parse = _parse;
    exports2.parse = (0, exports2._parse)(errors2.$ZodRealError);
    const _parseAsync = (_Err) => {
      const fn = async (schema, value, _ctx, params) => {
        const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
        let result = schema._zod.run({ value, issues: [] }, ctx);
        if (result instanceof Promise)
          result = await result;
        if (result.issues.length) {
          const e = new (params?.Err ?? _Err)(result.issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config())));
          util2.captureStackTrace(e, params?.callee ?? fn);
          throw e;
        }
        return result.value;
      };
      return fn;
    };
    exports2._parseAsync = _parseAsync;
    exports2.parseAsync = (0, exports2._parseAsync)(errors2.$ZodRealError);
    const _safeParse = (_Err) => (schema, value, _ctx) => {
      const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
      const result = schema._zod.run({ value, issues: [] }, ctx);
      if (result instanceof Promise) {
        throw new core2.$ZodAsyncError();
      }
      return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
    };
    exports2._safeParse = _safeParse;
    exports2.safeParse = (0, exports2._safeParse)(errors2.$ZodRealError);
    function failure(Err, issues, ctx) {
      let error;
      return {
        success: false,
        get error() {
          if (!error) {
            error = new Err(issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config())));
            issues = void 0;
            ctx = void 0;
          }
          return error;
        },
        set error(e) {
          error = e;
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
    exports2._safeParseAsync = _safeParseAsync;
    exports2.safeParseAsync = (0, exports2._safeParseAsync)(errors2.$ZodRealError);
    const COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
    const COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
    exports2.validate = ((schema, value, _ctx) => {
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
        throw new core2.$ZodAsyncError();
      }
      return result.issues.length === 0;
    }
    const validateAsync = async (schema, value, _ctx) => {
      const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
      let result = schema._zod.run({ value, issues: [] }, ctx);
      if (result instanceof Promise)
        result = await result;
      return result.issues.length === 0;
    };
    exports2.validateAsync = validateAsync;
    const _encode = (_Err) => {
      const parse2 = (0, exports2._parse)(_Err);
      const fn = (schema, value, _ctx, _params) => {
        const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
        return parse2(schema, value, ctx, finalizeParams(fn, _params));
      };
      return fn;
    };
    exports2._encode = _encode;
    exports2.encode = (0, exports2._encode)(errors2.$ZodRealError);
    const _decode = (_Err) => {
      const parse2 = (0, exports2._parse)(_Err);
      const fn = (schema, value, _ctx, _params) => {
        return parse2(schema, value, _ctx, finalizeParams(fn, _params));
      };
      return fn;
    };
    exports2._decode = _decode;
    exports2.decode = (0, exports2._decode)(errors2.$ZodRealError);
    const _encodeAsync = (_Err) => {
      const parseAsync = (0, exports2._parseAsync)(_Err);
      const fn = async (schema, value, _ctx, _params) => {
        const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
        return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
      };
      return fn;
    };
    exports2._encodeAsync = _encodeAsync;
    exports2.encodeAsync = (0, exports2._encodeAsync)(errors2.$ZodRealError);
    const _decodeAsync = (_Err) => {
      const parseAsync = (0, exports2._parseAsync)(_Err);
      const fn = async (schema, value, _ctx, _params) => {
        return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
      };
      return fn;
    };
    exports2._decodeAsync = _decodeAsync;
    exports2.decodeAsync = (0, exports2._decodeAsync)(errors2.$ZodRealError);
    const _safeEncode = (_Err) => (schema, value, _ctx) => {
      const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
      return (0, exports2._safeParse)(_Err)(schema, value, ctx);
    };
    exports2._safeEncode = _safeEncode;
    exports2.safeEncode = (0, exports2._safeEncode)(errors2.$ZodRealError);
    const _safeDecode = (_Err) => (schema, value, _ctx) => {
      return (0, exports2._safeParse)(_Err)(schema, value, _ctx);
    };
    exports2._safeDecode = _safeDecode;
    exports2.safeDecode = (0, exports2._safeDecode)(errors2.$ZodRealError);
    const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
      const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
      return (0, exports2._safeParseAsync)(_Err)(schema, value, ctx);
    };
    exports2._safeEncodeAsync = _safeEncodeAsync;
    exports2.safeEncodeAsync = (0, exports2._safeEncodeAsync)(errors2.$ZodRealError);
    const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
      return (0, exports2._safeParseAsync)(_Err)(schema, value, _ctx);
    };
    exports2._safeDecodeAsync = _safeDecodeAsync;
    exports2.safeDecodeAsync = (0, exports2._safeDecodeAsync)(errors2.$ZodRealError);
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(parse$1);
  return parse$1;
}
var schemas$1 = {};
var checks$1 = {};
var regexes = {};
var hasRequiredRegexes;
function requireRegexes() {
  if (hasRequiredRegexes) return regexes;
  hasRequiredRegexes = 1;
  (function(exports2) {
    var __createBinding = regexes && regexes.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = regexes && regexes.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = regexes && regexes.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.sha1_base64 = exports2.sha1_hex = exports2.md5_base64url = exports2.md5_base64 = exports2.md5_hex = exports2.hex = exports2.uppercase = exports2.lowercase = exports2.undefined = exports2.null = exports2.boolean = exports2.number = exports2.integer = exports2.bigint = exports2.string = exports2.anyString = exports2.date = exports2.iban = exports2.currencyCode = exports2.creditCard = exports2.e164 = exports2.httpProtocol = exports2.domain = exports2.hostname = exports2.base64url = exports2.base64 = exports2.cidrv6 = exports2.cidrv4 = exports2.mac = exports2.ipv6 = exports2.ipv4 = exports2.browserEmail = exports2.idnEmail = exports2.unicodeEmail = exports2.rfc5322Email = exports2.html5Email = exports2.email = exports2.uuid7 = exports2.uuid6 = exports2.uuid4 = exports2.uuid = exports2.guid = exports2.extendedDuration = exports2.duration = exports2.nanoid = exports2.ksuid = exports2.xid = exports2.ulid = exports2.cuid2 = exports2.cuid = void 0;
    exports2.sha512_base64url = exports2.sha512_base64 = exports2.sha512_hex = exports2.sha384_base64url = exports2.sha384_base64 = exports2.sha384_hex = exports2.sha256_base64url = exports2.sha256_base64 = exports2.sha256_hex = exports2.sha1_base64url = void 0;
    exports2.nanoidOfLength = nanoidOfLength;
    exports2.emoji = emoji;
    exports2.time = time;
    exports2.datetime = datetime;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    exports2.cuid = /^[cC][0-9a-z]{6,}$/;
    exports2.cuid2 = /^[0-9a-z]+$/;
    exports2.ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
    exports2.xid = /^[0-9a-vA-V]{20}$/;
    exports2.ksuid = /^[A-Za-z0-9]{27}$/;
    exports2.nanoid = /^[a-zA-Z0-9_-]{21}$/;
    function nanoidOfLength(length) {
      return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
    }
    exports2.duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
    exports2.extendedDuration = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
    exports2.guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
    const uuid = (version2) => {
      if (!version2)
        return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
      return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
    };
    exports2.uuid = uuid;
    exports2.uuid4 = (0, exports2.uuid)(4);
    exports2.uuid6 = (0, exports2.uuid)(6);
    exports2.uuid7 = (0, exports2.uuid)(7);
    exports2.email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
    exports2.html5Email = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    exports2.rfc5322Email = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    exports2.unicodeEmail = /^[^\s@"]{1,64}@[^\s@]{1,255}$/u;
    exports2.idnEmail = exports2.unicodeEmail;
    exports2.browserEmail = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    const _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
    function emoji() {
      return new RegExp(_emoji, "u");
    }
    exports2.ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
    exports2.ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
    const mac = (delimiter) => {
      const escapedDelim = util2.escapeRegex(delimiter ?? ":");
      return new RegExp(`^(?:[0-9A-F]{2}${escapedDelim}){5}[0-9A-F]{2}$|^(?:[0-9a-f]{2}${escapedDelim}){5}[0-9a-f]{2}$`);
    };
    exports2.mac = mac;
    exports2.cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
    exports2.cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
    exports2.base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
    exports2.base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
    exports2.hostname = /^(?=.{1,253}\.?$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-0-9a-zA-Z]{0,61}[0-9a-zA-Z])?)*\.?$/;
    exports2.domain = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
    exports2.httpProtocol = /^https?$/;
    exports2.e164 = /^\+[1-9]\d{6,14}$/;
    exports2.creditCard = /^\d(?:[ -]?\d){11,18}$/;
    exports2.currencyCode = /^(?:AED|AFN|ALL|AMD|AOA|ARS|AUD|AWG|AZN|BAM|BBD|BDT|BHD|BIF|BMD|BND|BOB|BOV|BRL|BSD|BTN|BWP|BYN|BZD|CAD|CDF|CHE|CHF|CHW|CLF|CLP|CNY|COP|COU|CRC|CUP|CVE|CZK|DJF|DKK|DOP|DZD|EGP|ERN|ETB|EUR|FJD|FKP|GBP|GEL|GHS|GIP|GMD|GNF|GTQ|GYD|HKD|HNL|HTG|HUF|IDR|ILS|INR|IQD|IRR|ISK|JMD|JOD|JPY|KES|KGS|KHR|KMF|KPW|KRW|KWD|KYD|KZT|LAK|LBP|LKR|LRD|LSL|LYD|MAD|MDL|MGA|MKD|MMK|MNT|MOP|MRU|MUR|MVR|MWK|MXN|MXV|MYR|MZN|NAD|NGN|NIO|NOK|NPR|NZD|OMR|PAB|PEN|PGK|PHP|PKR|PLN|PYG|QAR|RON|RSD|RUB|RWF|SAR|SBD|SCR|SDG|SEK|SGD|SHP|SLE|SOS|SRD|SSP|STN|SVC|SYP|SZL|THB|TJS|TMT|TND|TOP|TRY|TTD|TWD|TZS|UAH|UGX|USD|USN|UYI|UYU|UYW|UZS|VED|VES|VND|VUV|WST|XAD|XAF|XAG|XAU|XBA|XBB|XBC|XBD|XCD|XCG|XDR|XOF|XPD|XPF|XPT|XSU|XTS|XUA|XXX|YER|ZAR|ZMW|ZWG)$/;
    exports2.iban = /^[A-Z]{2}(?!00|01|99)\d{2}[A-Z0-9]{11,30}$/;
    const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
    function anchor(source) {
      return new RegExp(`^${source}$`);
    }
    exports2.date = anchor(dateSource);
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
    exports2.anyString = /^[\s\S]{0,}$/;
    const string = (params) => {
      const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
      return new RegExp(`^${regex}$`);
    };
    exports2.string = string;
    exports2.bigint = /^-?\d+n?$/;
    exports2.integer = /^-?\d+$/;
    exports2.number = /^-?\d+(?:\.\d+)?$/;
    exports2.boolean = /^(?:true|false)$/i;
    const _null = /^null$/i;
    exports2.null = _null;
    const _undefined = /^undefined$/i;
    exports2.undefined = _undefined;
    exports2.lowercase = /^[^A-Z]*$/;
    exports2.uppercase = /^[^a-z]*$/;
    exports2.hex = /^[0-9a-fA-F]*$/;
    function fixedBase64(bodyLength, padding) {
      return new RegExp(`^[A-Za-z0-9+/]{${bodyLength}}${padding}$`);
    }
    function fixedBase64url(length) {
      return new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
    }
    exports2.md5_hex = /^[0-9a-fA-F]{32}$/;
    exports2.md5_base64 = fixedBase64(22, "==");
    exports2.md5_base64url = fixedBase64url(22);
    exports2.sha1_hex = /^[0-9a-fA-F]{40}$/;
    exports2.sha1_base64 = fixedBase64(27, "=");
    exports2.sha1_base64url = fixedBase64url(27);
    exports2.sha256_hex = /^[0-9a-fA-F]{64}$/;
    exports2.sha256_base64 = fixedBase64(43, "=");
    exports2.sha256_base64url = fixedBase64url(43);
    exports2.sha384_hex = /^[0-9a-fA-F]{96}$/;
    exports2.sha384_base64 = fixedBase64(64, "");
    exports2.sha384_base64url = fixedBase64url(64);
    exports2.sha512_hex = /^[0-9a-fA-F]{128}$/;
    exports2.sha512_base64 = fixedBase64(86, "==");
    exports2.sha512_base64url = fixedBase64url(86);
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(regexes);
  return regexes;
}
var hasRequiredChecks$1;
function requireChecks$1() {
  if (hasRequiredChecks$1) return checks$1;
  hasRequiredChecks$1 = 1;
  (function(exports2) {
    var __createBinding = checks$1 && checks$1.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = checks$1 && checks$1.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = checks$1 && checks$1.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.$ZodCheckOverwrite = exports2.$ZodCheckMimeType = exports2.$ZodCheckProperties = exports2.$ZodCheckProperty = exports2.$ZodCheckEndsWith = exports2.$ZodCheckStartsWith = exports2.$ZodCheckIncludes = exports2.$ZodCheckUpperCase = exports2.$ZodCheckLowerCase = exports2.$ZodCheckRegex = exports2.$ZodCheckStringFormat = exports2.$ZodCheckLengthEquals = exports2.$ZodCheckMinLength = exports2.$ZodCheckMaxLength = exports2.$ZodCheckSizeEquals = exports2.$ZodCheckMinSize = exports2.$ZodCheckMaxSize = exports2.$ZodCheckBigIntFormat = exports2.$ZodCheckNumberFormat = exports2.$ZodCheckMultipleOf = exports2.$ZodCheckGreaterThan = exports2.$ZodCheckLessThan = exports2.$ZodCheck = void 0;
    const core2 = __importStar(/* @__PURE__ */ requireCore$1());
    const regexes2 = __importStar(/* @__PURE__ */ requireRegexes());
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    exports2.$ZodCheck = core2.$constructor("$ZodCheck", (inst, def) => {
      var _a;
      inst._zod ?? (inst._zod = {});
      inst._zod.def = def;
      (_a = inst._zod).onattach ?? (_a.onattach = []);
    });
    const _whenHasSize = (payload) => {
      const val = payload.value;
      return !util2.nullish(val) && val.size !== void 0;
    };
    const _whenHasLength = (payload) => {
      const val = payload.value;
      return !util2.nullish(val) && val.length !== void 0;
    };
    const numericOriginMap = {
      number: "number",
      bigint: "bigint",
      object: "date"
    };
    exports2.$ZodCheckLessThan = core2.$constructor("$ZodCheckLessThan", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
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
    exports2.$ZodCheckGreaterThan = core2.$constructor("$ZodCheckGreaterThan", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
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
    exports2.$ZodCheckMultipleOf = /* @__PURE__ */ core2.$constructor("$ZodCheckMultipleOf", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
      inst._zod.check = (payload) => {
        if (typeof payload.value !== typeof def.value)
          throw new Error("Cannot mix number and bigint in multiple_of check.");
        const isMultiple = typeof payload.value === "bigint" ? (
          // `value % 0n` throws, and nothing is a multiple of zero — the number branch already fails this way via NaN
          def.value !== BigInt(0) && payload.value % def.value === BigInt(0)
        ) : util2.floatSafeRemainder(payload.value, def.value) === 0;
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
    exports2.$ZodCheckNumberFormat = core2.$constructor("$ZodCheckNumberFormat", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
      def.format = def.format || "float64";
      const isInt = def.format?.includes("int");
      const origin2 = isInt ? "int" : "number";
      const [minimum, maximum] = util2.NUMBER_FORMAT_RANGES[def.format];
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
    exports2.$ZodCheckBigIntFormat = core2.$constructor("$ZodCheckBigIntFormat", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
      const [minimum, maximum] = util2.BIGINT_FORMAT_RANGES[def.format];
      inst._zod.check = (payload) => {
        const input = payload.value;
        if (input < minimum) {
          payload.issues.push({
            origin: "bigint",
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
            origin: "bigint",
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
    exports2.$ZodCheckMaxSize = core2.$constructor("$ZodCheckMaxSize", (inst, def) => {
      var _a;
      exports2.$ZodCheck.init(inst, def);
      (_a = inst._zod.def).when ?? (_a.when = _whenHasSize);
      inst._zod.check = (payload) => {
        const input = payload.value;
        const size = input.size;
        if (size <= def.maximum)
          return;
        payload.issues.push({
          origin: util2.getSizableOrigin(input),
          code: "too_big",
          maximum: def.maximum,
          inclusive: true,
          input,
          inst,
          continue: !def.abort
        });
      };
    });
    exports2.$ZodCheckMinSize = core2.$constructor("$ZodCheckMinSize", (inst, def) => {
      var _a;
      exports2.$ZodCheck.init(inst, def);
      (_a = inst._zod.def).when ?? (_a.when = _whenHasSize);
      inst._zod.check = (payload) => {
        const input = payload.value;
        const size = input.size;
        if (size >= def.minimum)
          return;
        payload.issues.push({
          origin: util2.getSizableOrigin(input),
          code: "too_small",
          minimum: def.minimum,
          inclusive: true,
          input,
          inst,
          continue: !def.abort
        });
      };
    });
    exports2.$ZodCheckSizeEquals = core2.$constructor("$ZodCheckSizeEquals", (inst, def) => {
      var _a;
      exports2.$ZodCheck.init(inst, def);
      (_a = inst._zod.def).when ?? (_a.when = _whenHasSize);
      inst._zod.check = (payload) => {
        const input = payload.value;
        const size = input.size;
        if (size === def.size)
          return;
        const tooBig = size > def.size;
        payload.issues.push({
          origin: util2.getSizableOrigin(input),
          ...tooBig ? { code: "too_big", maximum: def.size } : { code: "too_small", minimum: def.size },
          inclusive: true,
          exact: true,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    exports2.$ZodCheckMaxLength = core2.$constructor("$ZodCheckMaxLength", (inst, def) => {
      var _a;
      exports2.$ZodCheck.init(inst, def);
      (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
      inst._zod.check = (payload) => {
        const input = payload.value;
        const units = input.length;
        const length = typeof input === "string" && units > def.maximum ? util2.codePointLength(input) : units;
        if (length <= def.maximum)
          return;
        const origin2 = util2.getLengthableOrigin(input);
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
    exports2.$ZodCheckMinLength = core2.$constructor("$ZodCheckMinLength", (inst, def) => {
      var _a;
      exports2.$ZodCheck.init(inst, def);
      (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
      inst._zod.check = (payload) => {
        const input = payload.value;
        const units = input.length;
        const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? util2.codePointLength(input) : units;
        if (length >= def.minimum)
          return;
        const origin2 = util2.getLengthableOrigin(input);
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
    exports2.$ZodCheckLengthEquals = core2.$constructor("$ZodCheckLengthEquals", (inst, def) => {
      var _a;
      exports2.$ZodCheck.init(inst, def);
      (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
      inst._zod.check = (payload) => {
        const input = payload.value;
        const units = input.length;
        const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? util2.codePointLength(input) : units;
        if (length === def.length)
          return;
        const origin2 = util2.getLengthableOrigin(input);
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
    exports2.$ZodCheckStringFormat = core2.$constructor("$ZodCheckStringFormat", (inst, def) => {
      var _a, _b;
      exports2.$ZodCheck.init(inst, def);
      if (def.pattern)
        (_a = inst._zod).check ?? (_a.check = (payload) => {
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
    exports2.$ZodCheckRegex = core2.$constructor("$ZodCheckRegex", (inst, def) => {
      exports2.$ZodCheckStringFormat.init(inst, def);
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
    exports2.$ZodCheckLowerCase = core2.$constructor("$ZodCheckLowerCase", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.lowercase);
      exports2.$ZodCheckStringFormat.init(inst, def);
    });
    exports2.$ZodCheckUpperCase = core2.$constructor("$ZodCheckUpperCase", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.uppercase);
      exports2.$ZodCheckStringFormat.init(inst, def);
    });
    exports2.$ZodCheckIncludes = core2.$constructor("$ZodCheckIncludes", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
      const escapedRegex = util2.escapeRegex(def.includes);
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
    exports2.$ZodCheckStartsWith = core2.$constructor("$ZodCheckStartsWith", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
      const pattern = new RegExp(`^${util2.escapeRegex(def.prefix)}.*`);
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
    exports2.$ZodCheckEndsWith = core2.$constructor("$ZodCheckEndsWith", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
      const pattern = new RegExp(`.*${util2.escapeRegex(def.suffix)}$`);
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
        payload.issues.push(...util2.prefixIssues(property, result.issues));
      }
    }
    exports2.$ZodCheckProperty = core2.$constructor("$ZodCheckProperty", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
      inst._zod.check = (payload) => {
        const result = def.schema._zod.run({
          value: payload.value[def.property],
          issues: []
        }, {});
        if (result instanceof Promise) {
          return result.then((result2) => handleCheckPropertyResult(result2, payload, def.property));
        }
        handleCheckPropertyResult(result, payload, def.property);
        return;
      };
    });
    exports2.$ZodCheckProperties = core2.$constructor("$ZodCheckProperties", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
      util2.hide(inst, Symbol.iterator, function* () {
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
    exports2.$ZodCheckMimeType = core2.$constructor("$ZodCheckMimeType", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
      const mimeSet = new Set(def.mime);
      inst._zod.check = (payload) => {
        if (mimeSet.has(payload.value.type))
          return;
        payload.issues.push({
          code: "invalid_value",
          values: def.mime,
          input: payload.value.type,
          inst,
          continue: !def.abort
        });
      };
    });
    exports2.$ZodCheckOverwrite = core2.$constructor("$ZodCheckOverwrite", (inst, def) => {
      exports2.$ZodCheck.init(inst, def);
      inst._zod.check = (payload) => {
        payload.value = def.tx(payload.value);
      };
    });
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(checks$1);
  return checks$1;
}
var doc = {};
var hasRequiredDoc;
function requireDoc() {
  if (hasRequiredDoc) return doc;
  hasRequiredDoc = 1;
  (function(exports2) {
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Doc = void 0;
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
    exports2.Doc = Doc;
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(doc);
  return doc;
}
var versions = {};
var hasRequiredVersions;
function requireVersions() {
  if (hasRequiredVersions) return versions;
  hasRequiredVersions = 1;
  (function(exports2) {
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.version = void 0;
    exports2.version = {
      major: 4,
      minor: 6,
      patch: 7
    };
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(versions);
  return versions;
}
var hasRequiredSchemas$1;
function requireSchemas$1() {
  if (hasRequiredSchemas$1) return schemas$1;
  hasRequiredSchemas$1 = 1;
  (function(exports2) {
    var __createBinding = schemas$1 && schemas$1.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = schemas$1 && schemas$1.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = schemas$1 && schemas$1.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.$ZodObject = exports2.$ZodArray = exports2.$ZodDate = exports2.$ZodVoid = exports2.$ZodNever = exports2.$ZodUnknown = exports2.$ZodAny = exports2.$ZodNull = exports2.$ZodUndefined = exports2.$ZodSymbol = exports2.$ZodBigIntFormat = exports2.$ZodBigInt = exports2.$ZodBoolean = exports2.$ZodNumberFormat = exports2.$ZodNumber = exports2.$ZodCustomStringFormat = exports2.$ZodJWT = exports2.$ZodIBAN = exports2.$ZodCreditCard = exports2.$ZodE164 = exports2.$ZodBase64URL = exports2.base64urlCharset = exports2.$ZodBase64 = exports2.base64Charset = exports2.$ZodCIDRv6 = exports2.$ZodCIDRv4 = exports2.$ZodMAC = exports2.$ZodIPv6 = exports2.$ZodIPv4 = exports2.$ZodISODuration = exports2.$ZodISOTime = exports2.$ZodISODate = exports2.$ZodISODateTime = exports2.$ZodKSUID = exports2.$ZodXID = exports2.$ZodULID = exports2.$ZodCUID2 = exports2.$ZodCUID = exports2.$ZodNanoID = exports2.$ZodEmoji = exports2.$ZodURL = exports2.URL_UNPARSEABLE = exports2.URL_BAD_FORMAT = exports2.$ZodEmail = exports2.$ZodUUID = exports2.$ZodGUID = exports2.$ZodStringFormat = exports2.$ZodString = exports2.clone = exports2.$ZodType = void 0;
    exports2.$ZodCustom = exports2.$ZodLazy = exports2.$ZodPromise = exports2.$ZodFunction = exports2.$ZodTemplateLiteral = exports2.$ZodReadonly = exports2.$ZodPreprocess = exports2.$ZodCodec = exports2.$ZodPipe = exports2.$ZodNaN = exports2.$ZodCatch = exports2.$ZodSuccess = exports2.$ZodNonOptional = exports2.$ZodPrefault = exports2.$ZodDefault = exports2.$ZodNullable = exports2.$ZodExactOptional = exports2.$ZodOptional = exports2.$ZodTransform = exports2.$ZodFile = exports2.$ZodLiteral = exports2.$ZodEnum = exports2.$ZodSet = exports2.$ZodMap = exports2.$ZodRecord = exports2.$ZodTuple = exports2.$ZodIntersection = exports2.$ZodDiscriminatedUnion = exports2.$ZodXor = exports2.$ZodUnion = exports2.$ZodObjectJIT = void 0;
    exports2.standardProps = standardProps;
    exports2.canParseURL = canParseURL;
    exports2.validateURL = validateURL;
    exports2.parseURLObject = parseURLObject;
    exports2.stripTabAndNewline = stripTabAndNewline;
    exports2.urlHostnameOk = urlHostnameOk;
    exports2.urlProtocolOk = urlProtocolOk;
    exports2.isValidIPv6 = isValidIPv6;
    exports2.isValidCIDRv6 = isValidCIDRv6;
    exports2.isValidBase64 = isValidBase64;
    exports2.isValidBase64URL = isValidBase64URL;
    exports2.isValidCreditCard = isValidCreditCard;
    exports2.isValidIBAN = isValidIBAN;
    exports2.isValidJWT = isValidJWT;
    exports2.getDiscriminatedOption = getDiscriminatedOption;
    exports2.mergeValues = mergeValues;
    const checks2 = __importStar(/* @__PURE__ */ requireChecks$1());
    const core2 = __importStar(/* @__PURE__ */ requireCore$1());
    const doc_js_1 = /* @__PURE__ */ requireDoc();
    const parse_js_1 = /* @__PURE__ */ requireParse$1();
    const regexes2 = __importStar(/* @__PURE__ */ requireRegexes());
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const versions_js_1 = /* @__PURE__ */ requireVersions();
    exports2.$ZodType = core2.$constructor("$ZodType", (inst, def) => {
      var _a;
      inst ?? (inst = {});
      inst._zod.def = def;
      inst._zod.bag = inst._zod.bag || {};
      inst._zod.version = versions_js_1.version;
      const defChecks = inst._zod.def.checks;
      const checks3 = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
      for (const ch of checks3) {
        for (const fn of ch._zod.onattach) {
          fn(inst);
        }
      }
      if (checks3.length === 0) {
        (_a = inst._zod).deferred ?? (_a.deferred = []);
        inst._zod.deferred?.push(() => {
          inst._zod.run = inst._zod.parse;
        });
      } else {
        const runChecks = (payload, checks4, ctx) => {
          if (payload.memo)
            return payload;
          let isAborted = util2.aborted(payload);
          let asyncResult;
          for (const ch of checks4) {
            if (ch._zod.def.when) {
              if (util2.explicitlyAborted(payload))
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
              throw new core2.$ZodAsyncError();
            }
            if (asyncResult || _ instanceof Promise) {
              asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
                await _;
                const nextLen = payload.issues.length;
                if (nextLen === currLen)
                  return;
                util2.attachSchema(payload.issues, currLen, inst);
                if (!isAborted)
                  isAborted = util2.aborted(payload, currLen);
              });
            } else {
              const nextLen = payload.issues.length;
              if (nextLen === currLen)
                continue;
              util2.attachSchema(payload.issues, currLen, inst);
              if (!isAborted)
                isAborted = util2.aborted(payload, currLen);
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
          if (util2.aborted(canary)) {
            canary.aborted = true;
            return canary;
          }
          const checkResult = runChecks(payload, checks3, ctx);
          if (checkResult instanceof Promise) {
            if (ctx.async === false)
              throw new core2.$ZodAsyncError();
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
              throw new core2.$ZodAsyncError();
            return result.then((result2) => runChecks(result2, checks3, ctx));
          }
          return runChecks(result, checks3, ctx);
        };
      }
    }, {
      // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
      get "~standard"() {
        return util2.hide(this, "~standard", standardProps(this));
      },
      set "~standard"(value) {
        util2.own(this, "~standard", value);
      }
    });
    const toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config())) } : { value: r.value };
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
    var util_js_1 = /* @__PURE__ */ requireUtil();
    Object.defineProperty(exports2, "clone", { enumerable: true, get: function() {
      return util_js_1.clone;
    } });
    exports2.$ZodString = core2.$constructor("$ZodString", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.pattern = def.pattern ?? regexes2.anyString;
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
    exports2.$ZodStringFormat = core2.$constructor("$ZodStringFormat", (inst, def) => {
      checks2.$ZodCheckStringFormat.init(inst, def);
      exports2.$ZodString.init(inst, def);
    });
    exports2.$ZodGUID = core2.$constructor("$ZodGUID", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.guid);
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodUUID = core2.$constructor("$ZodUUID", (inst, def) => {
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
        def.pattern ?? (def.pattern = regexes2.uuid(v));
      } else
        def.pattern ?? (def.pattern = regexes2.uuid());
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodEmail = core2.$constructor("$ZodEmail", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.email);
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.URL_BAD_FORMAT = 1;
    exports2.URL_UNPARSEABLE = 2;
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
    function validateURL(trimmed, def) {
      if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
        return canParseURL(trimmed) || exports2.URL_UNPARSEABLE;
      }
      return parseURLObject(trimmed, def);
    }
    function parseURLObject(trimmed, def) {
      if (!def.normalize && def.protocol?.source === regexes2.httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
        return exports2.URL_BAD_FORMAT;
      }
      try {
        if (typeof URL !== "undefined") {
          const URLStatic = URL;
          if (typeof URLStatic.parse === "function")
            return URLStatic.parse(trimmed) ?? exports2.URL_UNPARSEABLE;
        }
        return new URL(trimmed);
      } catch {
        return exports2.URL_UNPARSEABLE;
      }
    }
    const asciiTabOrNewline = /[\t\n\r]/g;
    function stripTabAndNewline(value) {
      return value.replace(asciiTabOrNewline, "");
    }
    function urlHostnameOk(url, hostname) {
      hostname.lastIndex = 0;
      return hostname.test(url.hostname);
    }
    function urlProtocolOk(url, protocol) {
      protocol.lastIndex = 0;
      return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
    }
    exports2.$ZodURL = core2.$constructor("$ZodURL", (inst, def) => {
      exports2.$ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        try {
          const trimmed = payload.value.trim();
          const url = validateURL(trimmed, def);
          if (url === exports2.URL_BAD_FORMAT) {
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
          if (url === exports2.URL_UNPARSEABLE) {
            payload.issues.push({
              code: "invalid_format",
              format: "url",
              input: payload.value,
              inst,
              continue: !def.abort
            });
            return;
          }
          if (url === true) {
            payload.value = stripTabAndNewline(trimmed);
            return;
          }
          if (def.hostname && !urlHostnameOk(url, def.hostname)) {
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
          if (def.protocol && !urlProtocolOk(url, def.protocol)) {
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
          payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
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
    exports2.$ZodEmoji = core2.$constructor("$ZodEmoji", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.emoji());
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodNanoID = core2.$constructor("$ZodNanoID", (inst, def) => {
      if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1))
        throw new Error(`Invalid nanoid length: ${def.length}`);
      def.pattern ?? (def.pattern = def.length === void 0 ? regexes2.nanoid : regexes2.nanoidOfLength(def.length));
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodCUID = core2.$constructor("$ZodCUID", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.cuid);
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodCUID2 = core2.$constructor("$ZodCUID2", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.cuid2);
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodULID = core2.$constructor("$ZodULID", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.ulid);
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodXID = core2.$constructor("$ZodXID", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.xid);
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodKSUID = core2.$constructor("$ZodKSUID", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.ksuid);
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodISODateTime = core2.$constructor("$ZodISODateTime", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.datetime(def));
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodISODate = core2.$constructor("$ZodISODate", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.date);
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodISOTime = core2.$constructor("$ZodISOTime", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.time(def));
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodISODuration = core2.$constructor("$ZodISODuration", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.duration);
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodIPv4 = core2.$constructor("$ZodIPv4", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.ipv4);
      exports2.$ZodStringFormat.init(inst, def);
    });
    const ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
    function isValidIPv6(value) {
      if (!ipv6Alphabet.test(value))
        return false;
      return canParseURL(`http://[${value}]`);
    }
    exports2.$ZodIPv6 = core2.$constructor("$ZodIPv6", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.ipv6);
      exports2.$ZodStringFormat.init(inst, def);
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
    exports2.$ZodMAC = core2.$constructor("$ZodMAC", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.mac(def.delimiter));
      exports2.$ZodStringFormat.init(inst, def);
    });
    exports2.$ZodCIDRv4 = core2.$constructor("$ZodCIDRv4", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.cidrv4);
      exports2.$ZodStringFormat.init(inst, def);
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
    exports2.$ZodCIDRv6 = core2.$constructor("$ZodCIDRv6", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.cidrv6);
      exports2.$ZodStringFormat.init(inst, def);
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
    function isValidBase64(data2) {
      if (data2 === "")
        return true;
      if (/\s/.test(data2))
        return false;
      if (data2.length % 4 !== 0)
        return false;
      try {
        atob(data2);
        return true;
      } catch {
        return false;
      }
    }
    exports2.base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
    exports2.$ZodBase64 = core2.$constructor("$ZodBase64", (inst, def) => {
      def.pattern ?? (def.pattern = exports2.base64Charset);
      exports2.$ZodStringFormat.init(inst, def);
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
    exports2.base64urlCharset = /^[A-Za-z0-9_-]*$/;
    function isValidBase64URL(data2) {
      if (!exports2.base64urlCharset.test(data2))
        return false;
      const base64 = data2.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      return isValidBase64(padded);
    }
    exports2.$ZodBase64URL = core2.$constructor("$ZodBase64URL", (inst, def) => {
      def.pattern ?? (def.pattern = exports2.base64urlCharset);
      exports2.$ZodStringFormat.init(inst, def);
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
    exports2.$ZodE164 = core2.$constructor("$ZodE164", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.e164);
      exports2.$ZodStringFormat.init(inst, def);
    });
    const CC_SANITIZE = /[- ]/g;
    function isLuhnAlgo(digits) {
      let length = digits.length;
      let bit = 1;
      let sum = 0;
      while (length) {
        const value = digits.charCodeAt(--length) - 48;
        bit ^= 1;
        sum += bit ? [0, 2, 4, 6, 8, 1, 3, 5, 7, 9][value] : value;
      }
      return sum % 10 === 0;
    }
    function isValidCreditCard(input) {
      if (!regexes2.creditCard.test(input))
        return false;
      return isLuhnAlgo(input.replace(CC_SANITIZE, ""));
    }
    exports2.$ZodCreditCard = core2.$constructor("$ZodCreditCard", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.creditCard);
      exports2.$ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (isValidCreditCard(payload.value))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: "credit_card",
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    function isIso7064Mod97(iban) {
      let remainder = 0;
      const len = iban.length;
      for (let i = 4; i < len; i++) {
        const code = iban.charCodeAt(i);
        remainder = (code >= 65 ? remainder * 100 + (code - 55) : remainder * 10 + (code - 48)) % 97;
      }
      for (let i = 0; i < 4; i++) {
        const code = iban.charCodeAt(i);
        remainder = (code >= 65 ? remainder * 100 + (code - 55) : remainder * 10 + (code - 48)) % 97;
      }
      return remainder === 1;
    }
    function isValidIBAN(input) {
      if (!regexes2.iban.test(input))
        return false;
      return isIso7064Mod97(input);
    }
    exports2.$ZodIBAN = core2.$constructor("$ZodIBAN", (inst, def) => {
      def.pattern ?? (def.pattern = regexes2.iban);
      exports2.$ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (isValidIBAN(payload.value))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: "iban",
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
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
    exports2.$ZodJWT = core2.$constructor("$ZodJWT", (inst, def) => {
      exports2.$ZodStringFormat.init(inst, def);
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
    exports2.$ZodCustomStringFormat = core2.$constructor("$ZodCustomStringFormat", (inst, def) => {
      exports2.$ZodStringFormat.init(inst, def);
      inst._zod.check = (payload) => {
        if (def.fn(payload.value))
          return;
        payload.issues.push({
          code: "invalid_format",
          format: def.format,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      };
    });
    exports2.$ZodNumber = core2.$constructor("$ZodNumber", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.pattern = regexes2.number;
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
    exports2.$ZodNumberFormat = core2.$constructor("$ZodNumberFormat", (inst, def) => {
      checks2.$ZodCheckNumberFormat.init(inst, def);
      exports2.$ZodNumber.init(inst, def);
    });
    exports2.$ZodBoolean = core2.$constructor("$ZodBoolean", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.pattern = regexes2.boolean;
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
    exports2.$ZodBigInt = core2.$constructor("$ZodBigInt", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.pattern = regexes2.bigint;
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
    exports2.$ZodBigIntFormat = core2.$constructor("$ZodBigIntFormat", (inst, def) => {
      checks2.$ZodCheckBigIntFormat.init(inst, def);
      exports2.$ZodBigInt.init(inst, def);
    });
    exports2.$ZodSymbol = core2.$constructor("$ZodSymbol", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        const input = payload.value;
        if (typeof input === "symbol")
          return payload;
        payload.issues.push({
          expected: "symbol",
          code: "invalid_type",
          input,
          inst
        });
        return payload;
      };
    });
    exports2.$ZodUndefined = core2.$constructor("$ZodUndefined", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.pattern = regexes2.undefined;
      inst._zod.values = /* @__PURE__ */ new Set([void 0]);
      inst._zod.parse = (payload, _ctx) => {
        const input = payload.value;
        if (typeof input === "undefined")
          return payload;
        payload.issues.push({
          expected: "undefined",
          code: "invalid_type",
          input,
          inst
        });
        return payload;
      };
    });
    exports2.$ZodNull = core2.$constructor("$ZodNull", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.pattern = regexes2.null;
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
    exports2.$ZodAny = core2.$constructor("$ZodAny", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.parse = (payload) => payload;
    });
    exports2.$ZodUnknown = core2.$constructor("$ZodUnknown", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.parse = (payload) => payload;
    });
    exports2.$ZodNever = core2.$constructor("$ZodNever", (inst, def) => {
      exports2.$ZodType.init(inst, def);
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
    exports2.$ZodVoid = core2.$constructor("$ZodVoid", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        const input = payload.value;
        if (typeof input === "undefined")
          return payload;
        payload.issues.push({
          expected: "void",
          code: "invalid_type",
          input,
          inst
        });
        return payload;
      };
    });
    exports2.$ZodDate = core2.$constructor("$ZodDate", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        if (def.coerce) {
          try {
            payload.value = new Date(payload.value);
          } catch (_err) {
          }
        }
        const input = payload.value;
        const isDate = input instanceof Date;
        const isValidDate = isDate && !Number.isNaN(input.getTime());
        if (isValidDate)
          return payload;
        payload.issues.push({
          expected: "date",
          code: "invalid_type",
          input,
          ...isDate ? { received: "Invalid Date" } : {},
          inst
        });
        return payload;
      };
    });
    function capSize(inst, size) {
      const caps = util2.sizeCaps(inst._zod.def.checks);
      if (!caps.length)
        return;
      const cap = Math.min(...caps.map((c) => c[0]));
      const parse2 = inst._zod.parse;
      inst._zod.parse = (payload, ctx) => {
        const n = size(payload.value);
        if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
          for (const [max, ch] of util2.sizeCaps(inst._zod.def.checks)) {
            if (n > max && ch._zod.def.when(payload)) {
              const start = payload.issues.length;
              ch._zod.check(payload);
              payload.issues[start].continue = false;
              util2.attachSchema(payload.issues, start, inst);
              return payload;
            }
          }
        }
        return parse2(payload, ctx);
      };
    }
    const arraySize = (input) => Array.isArray(input) ? input.length : -1;
    const mapSize = (input) => input instanceof Map ? input.size : -1;
    const setSize = (input) => input instanceof Set ? input.size : -1;
    function handleArrayResult(result, final, index) {
      if (result.issues.length) {
        final.issues.push(...util2.prefixIssues(index, result.issues));
      }
      final.value[index] = result.value;
    }
    exports2.$ZodArray = core2.$constructor("$ZodArray", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      const memo = core2.globalConfig.memoizer;
      memo?.attach(inst);
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
        payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
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
            if (abortEarly && result.issues.length !== 0 && util2.aborted(result))
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
        final.issues.push(...util2.prefixIssues(key, result.issues));
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
      const keys = Object.keys(def.shape);
      const ownSymbols = Object.getOwnPropertySymbols(def.shape);
      const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
      const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
      for (const k of allKeys) {
        if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
          throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
        }
      }
      const okeys = util2.optionalKeys(def.shape);
      return {
        ...def,
        allKeys,
        symbolKeys,
        // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
        keySet: new Set(keys),
        numKeys: keys.length,
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
          if (util2.aborted(payload, seen))
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
    exports2.$ZodObject = core2.$constructor("$ZodObject", (inst, def) => {
      exports2.$ZodType.init(inst, def);
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
      const _normalized = util2.cached(() => normalizeDef(def));
      util2.defineLazyInternal(inst, "propValues", (zod2) => {
        const shape = zod2.def.shape;
        const propValues = {};
        for (const key in shape) {
          const field = shape[key]._zod;
          if (field.values) {
            if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
              util2.assignProp(propValues, key, /* @__PURE__ */ new Set());
            }
            for (const v of field.values)
              propValues[key].add(v);
            if (field.optin !== void 0)
              propValues[key].add(void 0);
          }
        }
        return propValues;
      });
      const isObject = util2.isObject;
      const catchall = def.catchall;
      let value;
      const memo = core2.globalConfig.memoizer;
      memo?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        value ?? (value = _normalized.value);
        const input = payload.value;
        if (!isObject(input)) {
          payload.issues.push({
            expected: "object",
            code: "invalid_type",
            input,
            inst
          });
          return payload;
        }
        payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
        const proms = [];
        const shape = value.shape;
        const abortEarly = ctx?.abortEarly;
        let seen = payload.issues.length;
        for (const key of value.allKeys) {
          if (abortEarly && payload.issues.length !== seen) {
            if (util2.aborted(payload, seen))
              break;
            seen = payload.issues.length;
          }
          if (key === "__proto__")
            continue;
          const el2 = shape[key];
          const optin = el2._zod.optin;
          const optout = el2._zod.optout;
          const r = el2._zod.run({ value: input[key], issues: [] }, ctx);
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
    exports2.$ZodObjectJIT = core2.$constructor("$ZodObjectJIT", (inst, def) => {
      exports2.$ZodObject.init(inst, def);
      const superParse = inst._zod.parse;
      const _normalized = util2.cached(() => normalizeDef(def));
      const memo = core2.globalConfig.memoizer;
      const generateFastpass = (shape) => {
        const normalized = _normalized.value;
        const syms = normalized.symbolKeys;
        const doc2 = new doc_js_1.Doc(["payload", "ctx"], { shape, inst, memo, syms });
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
        doc2.write(`const input = payload.value;`);
        const ids = /* @__PURE__ */ Object.create(null);
        let counter = 0;
        for (const key of normalized.allKeys) {
          ids[key] = `key_${counter++}`;
        }
        doc2.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
        for (const key of normalized.allKeys) {
          if (key === "__proto__")
            continue;
          const id2 = ids[key];
          const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : util2.esc(key);
          const isPresent = `${k} in input`;
          const schema = shape[key];
          const optin = schema?._zod?.optin;
          const isOptionalIn = optin !== void 0;
          const isOptionalOut = schema?._zod?.optout === "optional";
          doc2.write(`const ${id2} = ${parseStr(k)};`);
          if (isOptionalIn && isOptionalOut) {
            const assign = optin === "optional" ? `${id2}_present` : `${id2}.value !== undefined || ${id2}_present`;
            doc2.write(`
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
            doc2.write(`
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
            doc2.write(`
        if (${id2}.issues.length) {${prefixStr(id2, k)}
        }
      `);
            if (optin === "defaulted") {
              doc2.write(`newResult[${k}] = ${id2}.value;`);
            } else {
              doc2.write(`
        if (${id2}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id2}.value;
        }
      `);
            }
          }
        }
        doc2.write(`payload.value = newResult;`);
        doc2.write(`return payload;`);
        return doc2.compile();
      };
      let fastpass;
      const isObject = util2.isObject;
      const jit = !core2.globalConfig.jitless;
      const allowsEval = util2.allowsEval;
      const fastEnabled = jit && allowsEval.value;
      const catchall = def.catchall;
      let value;
      inst._zod.parse = (payload, ctx) => {
        value ?? (value = _normalized.value);
        const input = payload.value;
        if (!isObject(input)) {
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
      const nonaborted = results.filter((r) => !util2.aborted(r));
      if (nonaborted.length === 1) {
        final.value = nonaborted[0].value;
        return nonaborted[0];
      }
      final.issues.push({
        code: "invalid_union",
        input: final.value,
        inst,
        errors: results.map((result) => result.issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config())))
      });
      return final;
    }
    exports2.$ZodUnion = core2.$constructor("$ZodUnion", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      util2.defineLazyInternal(inst, "optin", (zod2) => zod2.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod2.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
      util2.defineLazyInternal(inst, "optout", (zod2) => zod2.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
      util2.defineLazyInternal(inst, "values", (zod2) => {
        if (zod2.def.options.every((o) => o._zod.values)) {
          return new Set(zod2.def.options.flatMap((option) => Array.from(option._zod.values)));
        }
        return void 0;
      });
      util2.defineLazyInternal(inst, "pattern", (zod2) => {
        if (zod2.def.options.every((o) => o._zod.pattern)) {
          const patterns = zod2.def.options.map((o) => o._zod.pattern);
          return new RegExp(`^(${patterns.map((p) => util2.cleanRegex(p.source)).join("|")})$`);
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
    function handleExclusiveUnionResults(results, final, inst, ctx) {
      const matches = [];
      for (let i = 0; i < results.length; i++) {
        if (results[i].issues.length === 0)
          matches.push(i);
      }
      if (matches.length === 1) {
        final.value = results[matches[0]].value;
        return final;
      }
      if (matches.length === 0) {
        final.issues.push({
          code: "invalid_union",
          input: final.value,
          inst,
          errors: results.map((result) => result.issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config())))
        });
      } else {
        final.issues.push({
          code: "invalid_union",
          input: final.value,
          inst,
          errors: [],
          inclusive: false,
          matches
        });
      }
      return final;
    }
    exports2.$ZodXor = core2.$constructor("$ZodXor", (inst, def) => {
      exports2.$ZodUnion.init(inst, def);
      def.inclusive = false;
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
            results.push(result);
          }
        }
        if (!async)
          return handleExclusiveUnionResults(results, payload, inst, ctx);
        return Promise.all(results).then((results2) => {
          return handleExclusiveUnionResults(results2, payload, inst, ctx);
        });
      };
    });
    function getDiscriminatedOption(union, value) {
      const internals = union._zod;
      let map = internals.bag.optionsMap;
      if (!map) {
        map = discriminatorMap(internals.def);
        internals.bag.optionsMap = map;
      }
      const option = map.get(value);
      if (option === null)
        throw new Error(`Ambiguous discriminator value "${String(value)}"`);
      return option;
    }
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
    exports2.$ZodDiscriminatedUnion = /* @__PURE__ */ core2.$constructor("$ZodDiscriminatedUnion", (inst, def) => {
      def.inclusive = false;
      exports2.$ZodUnion.init(inst, def);
      const _super = inst._zod.parse;
      util2.defineLazyInternal(inst, "propValues", (zod2) => {
        const propValues = {};
        let undefinedCount = 0;
        for (const option of zod2.def.options) {
          const pv = option._zod.propValues;
          if (!pv || Object.keys(pv).length === 0)
            throw new Error(`Invalid discriminated union option at index "${zod2.def.options.indexOf(option)}"`);
          if (pv[zod2.def.discriminator]?.has(void 0))
            undefinedCount++;
          for (const [k, v] of Object.entries(pv)) {
            if (!Object.prototype.hasOwnProperty.call(propValues, k)) {
              util2.assignProp(propValues, k, /* @__PURE__ */ new Set());
            }
            for (const val of v) {
              propValues[k].add(val);
            }
          }
        }
        if (!zod2.def.unionFallback && undefinedCount > 1)
          propValues[zod2.def.discriminator]?.delete(void 0);
        return propValues;
      });
      def.options.forEach((option, i) => {
        const propShape = util2.rawShape(option._zod.def);
        if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) {
          throw new Error(`Invalid discriminated union option at index "${i}"`);
        }
      });
      const disc = util2.cached(() => discriminatorMap(def));
      inst._zod.parse = (payload, ctx) => {
        const input = payload.value;
        if (!util2.isObject(input)) {
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
    exports2.$ZodIntersection = core2.$constructor("$ZodIntersection", (inst, def) => {
      exports2.$ZodType.init(inst, def);
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
      if (util2.isPlainObject(a) && util2.isPlainObject(b)) {
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
        for (let index = 0; index < a.length; index++) {
          const itemA = a[index];
          const itemB = b[index];
          const sharedValue = mergeValues(itemA, itemB);
          if (!sharedValue.valid) {
            return {
              valid: false,
              mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
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
        let keys;
        if (iss.code === "unrecognized_keys" && !iss.path?.length) {
          unrecIssue ?? (unrecIssue = iss);
          keys = iss.keys;
        } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
          const k = String(iss.path[0]);
          if (!keyIssues.has(k))
            keyIssues.set(k, iss);
          keys = [k];
        } else {
          return false;
        }
        for (const k of keys) {
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
        if (util2.aborted(result))
          return result;
        throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
      }
      result.value = merged.data;
      return result;
    }
    exports2.$ZodTuple = core2.$constructor("$ZodTuple", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      const items = def.items;
      const memo = core2.globalConfig.memoizer;
      memo?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        const input = payload.value;
        if (!Array.isArray(input)) {
          payload.issues.push({
            input,
            inst,
            expected: "tuple",
            code: "invalid_type"
          });
          return payload;
        }
        payload.value = memo ? memo.alloc(inst, payload, [], ctx) : [];
        const proms = [];
        const optinStart = getTupleOptStart(items, "optin");
        const optoutStart = getTupleOptStart(items, "optout");
        if (!def.rest) {
          if (input.length < optinStart) {
            payload.issues.push({
              code: "too_small",
              minimum: optinStart,
              inclusive: true,
              input,
              inst,
              origin: "array"
            });
            return payload;
          }
          if (input.length > items.length) {
            payload.issues.push({
              code: "too_big",
              maximum: items.length,
              inclusive: true,
              input,
              inst,
              origin: "array"
            });
          }
        }
        const itemResults = new Array(items.length);
        const abortEarly = def.rest ? ctx?.abortEarly : void 0;
        let itemAborted = false;
        for (let i = 0; i < items.length; i++) {
          const r = items[i]._zod.run({ value: input[i], issues: [] }, ctx);
          if (r instanceof Promise) {
            proms.push(r.then((rr) => {
              itemResults[i] = rr;
            }));
          } else {
            itemResults[i] = r;
            if (abortEarly && !itemAborted && r.issues.length)
              itemAborted = util2.aborted(r);
          }
        }
        if (def.rest && !itemAborted) {
          let i = items.length - 1;
          const rest = input.slice(items.length);
          let seen = payload.issues.length;
          for (const el2 of rest) {
            if (abortEarly && payload.issues.length !== seen) {
              if (util2.aborted(payload, seen))
                break;
              seen = payload.issues.length;
            }
            i++;
            const result = def.rest._zod.run({ value: el2, issues: [] }, ctx);
            if (result instanceof Promise) {
              proms.push(result.then((r) => handleTupleResult(r, payload, i)));
            } else {
              handleTupleResult(result, payload, i);
            }
          }
        }
        if (proms.length) {
          return Promise.all(proms).then(() => handleTupleResults(itemResults, payload, items, input, optoutStart));
        }
        return handleTupleResults(itemResults, payload, items, input, optoutStart);
      };
    });
    function getTupleOptStart(items, key) {
      for (let i = items.length - 1; i >= 0; i--) {
        const omittable = key === "optin" ? items[i]._zod.optin !== void 0 : items[i]._zod.optout === "optional";
        if (!omittable)
          return i + 1;
      }
      return 0;
    }
    function handleTupleResult(result, final, index) {
      if (result.issues.length) {
        final.issues.push(...util2.prefixIssues(index, result.issues));
      }
      final.value[index] = result.value;
    }
    function handleTupleResults(itemResults, final, items, input, optoutStart) {
      for (let i = 0; i < items.length; i++) {
        const r = itemResults[i];
        const isPresent = i < input.length;
        if (!isPresent && i >= optoutStart && items[i]._zod.optin === "optional") {
          final.value.length = i;
          break;
        }
        if (r.issues.length) {
          if (!isPresent && i >= optoutStart) {
            final.value.length = i;
            break;
          }
          final.issues.push(...util2.prefixIssues(i, r.issues));
        }
        final.value[i] = r.value;
      }
      for (let i = final.value.length - 1; i >= input.length; i--) {
        if (items[i]._zod.optout === "optional" && final.value[i] === void 0) {
          final.value.length = i;
        } else {
          break;
        }
      }
      return final;
    }
    exports2.$ZodRecord = core2.$constructor("$ZodRecord", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      const memo = core2.globalConfig.memoizer;
      memo?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        const input = payload.value;
        if (!util2.isPlainObject(input)) {
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
          payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
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
                  issues: keyResult.issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config())),
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
                    payload.issues.push(...util2.prefixIssues(key, result2.issues));
                  }
                  payload.value[outKey] = result2.value;
                }));
              } else {
                if (result.issues.length) {
                  payload.issues.push(...util2.prefixIssues(key, result.issues));
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
          payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
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
            const checkNumericKey = typeof key === "string" && regexes2.number.test(key) && keyResult.issues.length;
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
                  issues: keyResult.issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config())),
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
                  payload.issues.push(...util2.prefixIssues(key, result2.issues));
                }
                payload.value[outKey] = result2.value;
              }));
            } else {
              if (result.issues.length) {
                payload.issues.push(...util2.prefixIssues(key, result.issues));
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
    exports2.$ZodMap = core2.$constructor("$ZodMap", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      const memo = core2.globalConfig.memoizer;
      memo?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        const input = payload.value;
        if (!(input instanceof Map)) {
          payload.issues.push({
            expected: "map",
            code: "invalid_type",
            input,
            inst
          });
          return payload;
        }
        const proms = [];
        payload.value = memo ? memo.alloc(inst, payload, /* @__PURE__ */ new Map(), ctx) : /* @__PURE__ */ new Map();
        const abortEarly = ctx?.abortEarly;
        let seen = payload.issues.length;
        for (const [key, value] of input) {
          if (abortEarly && payload.issues.length !== seen) {
            if (util2.aborted(payload, seen))
              break;
            seen = payload.issues.length;
          }
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          const valueResult = def.valueType._zod.run({ value, issues: [] }, ctx);
          if (keyResult instanceof Promise || valueResult instanceof Promise) {
            proms.push(Promise.all([keyResult, valueResult]).then(([keyResult2, valueResult2]) => {
              handleMapResult(keyResult2, valueResult2, payload, key, input, inst, ctx);
            }));
          } else {
            handleMapResult(keyResult, valueResult, payload, key, input, inst, ctx);
          }
        }
        if (proms.length)
          return Promise.all(proms).then(() => payload);
        return payload;
      };
      capSize(inst, mapSize);
    });
    function handleMapResult(keyResult, valueResult, final, key, input, inst, ctx) {
      if (keyResult.issues.length) {
        if (util2.propertyKeyTypes.has(typeof key)) {
          final.issues.push(...util2.prefixIssues(key, keyResult.issues));
        } else {
          final.issues.push({
            code: "invalid_key",
            origin: "map",
            input,
            inst,
            issues: keyResult.issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config()))
          });
        }
      }
      if (valueResult.issues.length) {
        if (util2.propertyKeyTypes.has(typeof key)) {
          final.issues.push(...util2.prefixIssues(key, valueResult.issues));
        } else {
          final.issues.push({
            origin: "map",
            code: "invalid_element",
            input,
            inst,
            key,
            issues: valueResult.issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config()))
          });
        }
      }
      final.value.set(keyResult.value, valueResult.value);
    }
    exports2.$ZodSet = core2.$constructor("$ZodSet", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      const memo = core2.globalConfig.memoizer;
      memo?.attach(inst);
      inst._zod.parse = (payload, ctx) => {
        const input = payload.value;
        if (!(input instanceof Set)) {
          payload.issues.push({
            input,
            inst,
            expected: "set",
            code: "invalid_type"
          });
          return payload;
        }
        const proms = [];
        payload.value = memo ? memo.alloc(inst, payload, /* @__PURE__ */ new Set(), ctx) : /* @__PURE__ */ new Set();
        const abortEarly = ctx?.abortEarly;
        let seen = payload.issues.length;
        for (const item of input) {
          if (abortEarly && payload.issues.length !== seen) {
            if (util2.aborted(payload, seen))
              break;
            seen = payload.issues.length;
          }
          const result = def.valueType._zod.run({ value: item, issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => handleSetResult(result2, payload)));
          } else
            handleSetResult(result, payload);
        }
        if (proms.length)
          return Promise.all(proms).then(() => payload);
        return payload;
      };
      capSize(inst, setSize);
    });
    function handleSetResult(result, final) {
      if (result.issues.length) {
        final.issues.push(...result.issues);
      }
      final.value.add(result.value);
    }
    exports2.$ZodEnum = core2.$constructor("$ZodEnum", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      const values = util2.getEnumValues(def.entries);
      const valuesSet = new Set(values);
      inst._zod.values = valuesSet;
      util2.defineLazyInternal(inst, "pattern", (zod2) => {
        const patternValues = util2.getEnumValues(zod2.def.entries).filter((k) => util2.propertyKeyTypes.has(typeof k));
        return new RegExp(patternValues.length ? `^(${patternValues.map((o) => util2.escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
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
    exports2.$ZodLiteral = core2.$constructor("$ZodLiteral", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      const values = new Set(def.values);
      inst._zod.values = values;
      util2.defineLazyInternal(inst, "pattern", (zod2) => {
        const vals = zod2.def.values;
        return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? util2.escapeRegex(o) : o ? util2.escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
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
    exports2.$ZodFile = core2.$constructor("$ZodFile", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        const input = payload.value;
        if (input instanceof File)
          return payload;
        payload.issues.push({
          expected: "file",
          code: "invalid_type",
          input,
          inst
        });
        return payload;
      };
    });
    exports2.$ZodTransform = core2.$constructor("$ZodTransform", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.optin = "optional";
      core2.globalConfig.memoizer?.guard(inst);
      inst._zod.parse = (payload, ctx) => {
        if (ctx.direction === "backward") {
          throw new core2.$ZodEncodeError(inst.constructor.name);
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
          throw new core2.$ZodAsyncError();
        }
        payload.value = _out;
        return payload;
      };
    });
    function handleOptionalResult(payload, result) {
      payload.value = result.issues.length ? void 0 : result.value;
      return payload;
    }
    exports2.$ZodOptional = core2.$constructor("$ZodOptional", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      util2.defineLazyInternal(inst, "optin", (zod2) => zod2.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
      inst._zod.optout = "optional";
      util2.defineLazyInternal(inst, "values", (zod2) => {
        const values = zod2.def.innerType._zod.values;
        return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
      });
      util2.defineLazyInternal(inst, "pattern", (zod2) => {
        const pattern = zod2.def.innerType._zod.pattern;
        return pattern ? new RegExp(`^(${util2.cleanRegex(pattern.source)})?$`) : void 0;
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
    exports2.$ZodExactOptional = core2.$constructor("$ZodExactOptional", (inst, def) => {
      exports2.$ZodOptional.init(inst, def);
      util2.defineLazyInternal(inst, "values", (zod2) => zod2.def.innerType._zod.values);
      util2.defineLazyInternal(inst, "pattern", (zod2) => zod2.def.innerType._zod.pattern);
      inst._zod.parse = (payload, ctx) => {
        return def.innerType._zod.run(payload, ctx);
      };
    });
    exports2.$ZodNullable = core2.$constructor("$ZodNullable", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      util2.defineLazyInternal(inst, "optin", (zod2) => zod2.def.innerType._zod.optin);
      util2.defineLazyInternal(inst, "optout", (zod2) => zod2.def.innerType._zod.optout);
      util2.defineLazyInternal(inst, "pattern", (zod2) => {
        const pattern = zod2.def.innerType._zod.pattern;
        return pattern ? new RegExp(`^(${util2.cleanRegex(pattern.source)}|null)$`) : void 0;
      });
      util2.defineLazyInternal(inst, "values", (zod2) => {
        return zod2.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod2.def.innerType._zod.values, null]) : void 0;
      });
      inst._zod.parse = (payload, ctx) => {
        if (payload.value === null)
          return payload;
        return def.innerType._zod.run(payload, ctx);
      };
    });
    exports2.$ZodDefault = core2.$constructor("$ZodDefault", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.optin = "defaulted";
      util2.defineLazyInternal(inst, "values", (zod2) => zod2.def.innerType._zod.values);
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
    exports2.$ZodPrefault = core2.$constructor("$ZodPrefault", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.optin = "defaulted";
      util2.defineLazyInternal(inst, "values", (zod2) => zod2.def.innerType._zod.values);
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
    exports2.$ZodNonOptional = core2.$constructor("$ZodNonOptional", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      util2.defineLazyInternal(inst, "values", (zod2) => {
        const v = zod2.def.innerType._zod.values;
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
    exports2.$ZodSuccess = core2.$constructor("$ZodSuccess", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.parse = (payload, ctx) => {
        if (ctx.direction === "backward") {
          throw new core2.$ZodEncodeError("ZodSuccess");
        }
        const result = def.innerType._zod.run(payload, ctx);
        if (result instanceof Promise) {
          return result.then((result2) => {
            payload.value = result2.issues.length === 0;
            return payload;
          });
        }
        payload.value = result.issues.length === 0;
        return payload;
      };
    });
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
          issues: result.issues.map((iss) => util2.finalizeIssue(iss, ctx, core2.config()))
        },
        input: payload.value
      });
      return payload;
    }
    exports2.$ZodCatch = core2.$constructor("$ZodCatch", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      util2.defineLazyInternal(inst, "optin", (zod2) => zod2.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
      util2.defineLazyInternal(inst, "optout", (zod2) => zod2.def.innerType._zod.optout);
      util2.defineLazyInternal(inst, "values", (zod2) => zod2.def.innerType._zod.values);
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
    exports2.$ZodNaN = core2.$constructor("$ZodNaN", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.parse = (payload, _ctx) => {
        if (typeof payload.value !== "number" || !Number.isNaN(payload.value)) {
          payload.issues.push({
            input: payload.value,
            inst,
            expected: "nan",
            code: "invalid_type"
          });
          return payload;
        }
        return payload;
      };
    });
    exports2.$ZodPipe = core2.$constructor("$ZodPipe", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      util2.defineLazyInternal(inst, "values", (zod2) => zod2.def.in._zod.values);
      util2.defineLazyInternal(inst, "optin", (zod2) => zod2.def.in._zod.optin);
      util2.defineLazyInternal(inst, "optout", (zod2) => zod2.def.out._zod.optout);
      util2.defineLazyInternal(inst, "propValues", (zod2) => zod2.def.in._zod.propValues);
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
    exports2.$ZodCodec = core2.$constructor("$ZodCodec", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      util2.defineLazyInternal(inst, "values", (zod2) => zod2.def.in._zod.values);
      util2.defineLazyInternal(inst, "optin", (zod2) => zod2.def.in._zod.optin);
      util2.defineLazyInternal(inst, "optout", (zod2) => zod2.def.out._zod.optout);
      util2.defineLazyInternal(inst, "propValues", (zod2) => zod2.def.in._zod.propValues);
      inst._zod.parse = (payload, ctx) => {
        const direction = ctx.direction || "forward";
        if (direction === "forward") {
          const left = def.in._zod.run(payload, ctx);
          if (left instanceof Promise) {
            return left.then((left2) => handleCodecAResult(left2, def, ctx));
          }
          return handleCodecAResult(left, def, ctx);
        } else {
          const right = def.out._zod.run(payload, ctx);
          if (right instanceof Promise) {
            return right.then((right2) => handleCodecAResult(right2, def, ctx));
          }
          return handleCodecAResult(right, def, ctx);
        }
      };
    });
    function handleCodecAResult(result, def, ctx) {
      if (result.issues.length) {
        result.aborted = true;
        return result;
      }
      const direction = ctx.direction || "forward";
      if (direction === "forward") {
        const transformed = def.transform(result.value, result);
        if (transformed instanceof Promise) {
          return transformed.then((value) => handleCodecTxResult(result, value, def.out, ctx));
        }
        return handleCodecTxResult(result, transformed, def.out, ctx);
      } else {
        const transformed = def.reverseTransform(result.value, result);
        if (transformed instanceof Promise) {
          return transformed.then((value) => handleCodecTxResult(result, value, def.in, ctx));
        }
        return handleCodecTxResult(result, transformed, def.in, ctx);
      }
    }
    function handleCodecTxResult(left, value, nextSchema, ctx) {
      if (left.issues.length) {
        left.aborted = true;
        return left;
      }
      return nextSchema._zod.run({ value, issues: left.issues }, ctx);
    }
    exports2.$ZodPreprocess = core2.$constructor("$ZodPreprocess", (inst, def) => {
      exports2.$ZodPipe.init(inst, def);
    });
    exports2.$ZodReadonly = core2.$constructor("$ZodReadonly", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      util2.defineLazyInternal(inst, "propValues", (zod2) => zod2.def.innerType._zod.propValues);
      util2.defineLazyInternal(inst, "values", (zod2) => zod2.def.innerType._zod.values);
      util2.defineLazyInternal(inst, "optin", (zod2) => zod2.def.innerType?._zod?.optin);
      util2.defineLazyInternal(inst, "optout", (zod2) => zod2.def.innerType?._zod?.optout);
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
    function leafPattern(schema) {
      const def = schema._zod.def;
      let pattern = def.pattern;
      let isInt = !!def.format?.includes("int");
      let minimum;
      let maximum;
      for (const ch of def.checks ?? []) {
        const d = ch._zod.def;
        if (d.pattern)
          pattern = d.pattern;
        isInt || (isInt = !!d.format?.includes("int"));
        const lo = d.minimum ?? d.length;
        const hi2 = d.maximum ?? d.length;
        if (lo !== void 0 && (minimum === void 0 || lo > minimum))
          minimum = lo;
        if (hi2 !== void 0 && (maximum === void 0 || hi2 < maximum))
          maximum = hi2;
      }
      if (pattern)
        return pattern.source;
      if (minimum !== void 0 && maximum !== void 0 && minimum > maximum)
        return "(?!)";
      if (minimum !== void 0 || maximum !== void 0)
        return regexes2.string({ minimum, maximum }).source;
      const own = schema._zod.pattern;
      return (isInt && own === regexes2.number ? regexes2.integer : own)?.source;
    }
    function partPattern(schema) {
      const def = schema._zod.def;
      const own = schema._zod.pattern?.source;
      const inner = def.innerType ?? schema._zod.innerType;
      if (inner) {
        const before = inner._zod.pattern?.source;
        const after = partPattern(inner);
        if (own && before && after && after !== before) {
          return own.replace(util2.cleanRegex(before), () => util2.cleanRegex(after));
        }
        return own;
      }
      if (def.options) {
        const sources = def.options.map(partPattern);
        if (sources.every(Boolean))
          return `^(${sources.map((s) => util2.cleanRegex(s)).join("|")})$`;
      }
      return leafPattern(schema);
    }
    exports2.$ZodTemplateLiteral = core2.$constructor("$ZodTemplateLiteral", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      const regexParts = [];
      for (const part of def.parts) {
        if (typeof part === "object" && part !== null) {
          const source = partPattern(part);
          if (!source) {
            throw new Error(`Invalid template literal part, no pattern found: ${[...part._zod.traits].shift()}`);
          }
          regexParts.push(util2.cleanRegex(source));
        } else if (part === null || util2.primitiveTypes.has(typeof part)) {
          regexParts.push(util2.escapeRegex(`${part}`));
        } else {
          throw new Error(`Invalid template literal part: ${part}`);
        }
      }
      inst._zod.pattern = new RegExp(`^${regexParts.join("")}$`);
      inst._zod.parse = (payload, _ctx) => {
        if (typeof payload.value !== "string") {
          payload.issues.push({
            input: payload.value,
            inst,
            expected: "string",
            code: "invalid_type"
          });
          return payload;
        }
        inst._zod.pattern.lastIndex = 0;
        if (!inst._zod.pattern.test(payload.value)) {
          payload.issues.push({
            input: payload.value,
            inst,
            code: "invalid_format",
            format: def.format ?? "template_literal",
            pattern: inst._zod.pattern.source
          });
          return payload;
        }
        return payload;
      };
    });
    exports2.$ZodFunction = core2.$constructor("$ZodFunction", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      Object.defineProperty(inst, "_def", { value: def });
      inst._zod.def = def;
      inst.implement = (func) => {
        if (typeof func !== "function") {
          throw new Error("implement() must be called with a function");
        }
        return Object.defineProperty(function(...args) {
          const parsedArgs = inst._def.input ? (0, parse_js_1.parse)(inst._def.input, args) : args;
          const result = Reflect.apply(func, this, parsedArgs);
          if (inst._def.output) {
            return (0, parse_js_1.parse)(inst._def.output, result);
          }
          return result;
        }, "_zod", { value: inst._zod, enumerable: false });
      };
      inst.implementAsync = (func) => {
        if (typeof func !== "function") {
          throw new Error("implementAsync() must be called with a function");
        }
        return Object.defineProperty(async function(...args) {
          const parsedArgs = inst._def.input ? await (0, parse_js_1.parseAsync)(inst._def.input, args) : args;
          const result = await Reflect.apply(func, this, parsedArgs);
          if (inst._def.output) {
            return await (0, parse_js_1.parseAsync)(inst._def.output, result);
          }
          return result;
        }, "_zod", { value: inst._zod, enumerable: false });
      };
      inst._zod.parse = (payload, _ctx) => {
        if (typeof payload.value !== "function") {
          payload.issues.push({
            code: "invalid_type",
            expected: "function",
            input: payload.value,
            inst
          });
          return payload;
        }
        const hasPromiseOutput = inst._def.output && inst._def.output._zod.def.type === "promise";
        if (hasPromiseOutput) {
          payload.value = inst.implementAsync(payload.value);
        } else {
          payload.value = inst.implement(payload.value);
        }
        return payload;
      };
      inst.input = (...args) => {
        const F = inst.constructor;
        if (Array.isArray(args[0])) {
          return new F({
            type: "function",
            input: new exports2.$ZodTuple({
              type: "tuple",
              items: args[0],
              rest: args[1]
            }),
            output: inst._def.output
          });
        }
        return new F({
          type: "function",
          input: args[0],
          output: inst._def.output
        });
      };
      inst.output = (output) => {
        const F = inst.constructor;
        return new F({
          type: "function",
          input: inst._def.input,
          output
        });
      };
      return inst;
    });
    exports2.$ZodPromise = core2.$constructor("$ZodPromise", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      inst._zod.parse = (payload, ctx) => {
        return Promise.resolve(payload.value).then((inner) => def.innerType._zod.run({ value: inner, issues: [] }, ctx));
      };
    });
    exports2.$ZodLazy = core2.$constructor("$ZodLazy", (inst, def) => {
      exports2.$ZodType.init(inst, def);
      util2.defineLazy(inst._zod, "innerType", () => {
        const d = def;
        if (!d._cachedInner)
          d._cachedInner = def.getter();
        return d._cachedInner;
      });
      util2.defineLazyInternal(inst, "pattern", (zod2) => zod2.innerType?._zod?.pattern);
      util2.defineLazyInternal(inst, "propValues", (zod2) => zod2.innerType?._zod?.propValues);
      util2.defineLazyInternal(inst, "optin", (zod2) => zod2.innerType?._zod?.optin ?? void 0);
      util2.defineLazyInternal(inst, "optout", (zod2) => zod2.innerType?._zod?.optout ?? void 0);
      inst._zod.parse = (payload, ctx) => {
        const inner = inst._zod.innerType;
        return inner._zod.run(payload, ctx);
      };
    });
    exports2.$ZodCustom = core2.$constructor("$ZodCustom", (inst, def) => {
      checks2.$ZodCheck.init(inst, def);
      exports2.$ZodType.init(inst, def);
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
        payload.issues.push(util2.issue(_iss));
      }
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(schemas$1);
  return schemas$1;
}
var memoizer = {};
var hasRequiredMemoizer;
function requireMemoizer() {
  if (hasRequiredMemoizer) return memoizer;
  hasRequiredMemoizer = 1;
  (function(exports2) {
    var __createBinding = memoizer && memoizer.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = memoizer && memoizer.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = memoizer && memoizer.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.$ZodCyclicError = void 0;
    exports2.isRecursiveSchema = isRecursiveSchema;
    exports2.memoizer = memoizer$1;
    exports2.isBackEdge = isBackEdge;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    class $ZodCyclicError extends Error {
      constructor() {
        super(`Cannot parse a reference cycle that closes through a transform`);
        this.name = "ZodCyclicError";
      }
    }
    exports2.$ZodCyclicError = $ZodCyclicError;
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
      const cached = recursive.get(inst);
      if (cached !== void 0)
        return cached ? PROVEN : NONE;
      if (stack.has(inst))
        return PROVEN;
      stack.add(inst);
      let result = NONE;
      const check = (child) => {
        if (result !== PROVEN && child?._zod) {
          const answer = isRecursive(child, stack, resolve);
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
          const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
          if (child > answer)
            answer = child;
        }
        return answer;
      };
      const merge = (answer) => {
        if (answer > result)
          result = answer;
      };
      const def = inst._zod.def;
      const kind = def.type;
      switch (kind) {
        case "object": {
          const raw2 = util2.rawShape(def);
          merge(raw2 ? shape(raw2) : ASSUMED);
          check(def.catchall);
          break;
        }
        case "array":
          check(def.element);
          break;
        case "tuple":
          for (const el2 of def.items)
            check(el2);
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
          for (const el2 of def.options)
            check(el2);
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
          const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
          merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
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
              for (const el2 of value)
                check(el2);
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
    function isRecursiveSchema(inst) {
      return isRecursive(inst, /* @__PURE__ */ new Set(), true) !== NONE;
    }
    function bucketFor(state, inst) {
      let bucket = state.buckets.get(inst);
      if (!bucket) {
        bucket = /* @__PURE__ */ new WeakMap();
        state.buckets.set(inst, bucket);
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
        var _a;
        (_a = inst._zod).deferred ?? (_a.deferred = []);
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
        var _a;
        let isRecursiveInst;
        let rechecked = false;
        let lastCtx;
        let lastBucket;
        (_a = inst._zod).deferred ?? (_a.deferred = []);
        inst._zod.deferred.push(() => {
          const base = inst._zod.parse;
          const wrapped = (payload, ctx) => {
            if (isRecursiveInst === void 0) {
              const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
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
            let state = ctx[STATE];
            if (!state) {
              state = { buckets: /* @__PURE__ */ new WeakMap(), backEdges: void 0 };
              ctx[STATE] = state;
            }
            let bucket;
            if (lastCtx === ctx) {
              bucket = lastBucket;
            } else {
              bucket = bucketFor(state, inst);
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
                state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
                state.backEdges.add(hit.value);
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
    function memoizer$1() {
      return memo;
    }
    function isBackEdge(ctx, value) {
      const backEdges = ctx[STATE]?.backEdges;
      return backEdges !== void 0 && isRef(value) && backEdges.has(value);
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(memoizer);
  return memoizer;
}
var locales = {};
var ar$1 = { exports: {} };
var ar = ar$1.exports;
var hasRequiredAr;
function requireAr() {
  if (hasRequiredAr) return ar$1.exports;
  hasRequiredAr = 1;
  (function(module2, exports2) {
    var __createBinding = ar && ar.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ar && ar.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ar && ar.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "حرف", verb: "أن يحوي" },
        file: { unit: "بايت", verb: "أن يحوي" },
        array: { unit: "عنصر", verb: "أن يحوي" },
        set: { unit: "عنصر", verb: "أن يحوي" },
        map: { unit: "عنصر", verb: "أن يحوي" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "مدخل",
        email: "بريد إلكتروني",
        url: "رابط",
        emoji: "إيموجي",
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
        datetime: "تاريخ ووقت بمعيار ISO",
        date: "تاريخ بمعيار ISO",
        time: "وقت بمعيار ISO",
        duration: "مدة بمعيار ISO",
        ipv4: "عنوان IPv4",
        ipv6: "عنوان IPv6",
        mac: "عنوان MAC",
        cidrv4: "مدى عناوين بصيغة IPv4",
        cidrv6: "مدى عناوين بصيغة IPv6",
        base64: "نَص بترميز base64-encoded",
        base64url: "نَص بترميز base64url-encoded",
        json_string: "نَص على هيئة JSON",
        e164: "رقم هاتف بمعيار E.164",
        credit_card: "رقم بطاقة الائتمان",
        currency_code: "رمز العملة",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "مدخل"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `مدخلات غير مقبولة: يفترض إدخال instanceof ${issue.expected}، ولكن تم إدخال ${received}`;
            }
            return `مدخلات غير مقبولة: يفترض إدخال ${expected}، ولكن تم إدخال ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `مدخلات غير مقبولة: يفترض إدخال ${util2.stringifyPrimitive(issue.values[0])}`;
            return `اختيار غير مقبول: يتوقع انتقاء أحد هذه الخيارات: ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return ` أكبر من اللازم: يفترض أن تكون ${issue.origin ?? "القيمة"} ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "عنصر"}`;
            return `أكبر من اللازم: يفترض أن تكون ${issue.origin ?? "القيمة"} ${adj} ${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `أصغر من اللازم: يفترض لـ ${issue.origin} أن يكون ${adj} ${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `أصغر من اللازم: يفترض لـ ${issue.origin} أن يكون ${adj} ${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `نَص غير مقبول: يجب أن يبدأ بـ "${issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `نَص غير مقبول: يجب أن ينتهي بـ "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `نَص غير مقبول: يجب أن يتضمَّن "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `نَص غير مقبول: يجب أن يطابق النمط ${_issue.pattern}`;
            return `${FormatDictionary[_issue.format] ?? issue.format} غير مقبول`;
          }
          case "not_multiple_of":
            return `رقم غير مقبول: يجب أن يكون من مضاعفات ${issue.divisor}`;
          case "unrecognized_keys":
            return `معرف${issue.keys.length > 1 ? "ات" : ""} غريب${issue.keys.length > 1 ? "ة" : ""}: ${util2.joinValues(issue.keys, "، ")}`;
          case "invalid_key":
            return `معرف غير مقبول في ${issue.origin}`;
          case "invalid_union":
            return "مدخل غير مقبول";
          case "invalid_element":
            return `مدخل غير مقبول في ${issue.origin}`;
          default:
            return "مدخل غير مقبول";
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ar$1, ar$1.exports);
  return ar$1.exports;
}
var az$1 = { exports: {} };
var az = az$1.exports;
var hasRequiredAz;
function requireAz() {
  if (hasRequiredAz) return az$1.exports;
  hasRequiredAz = 1;
  (function(module2, exports2) {
    var __createBinding = az && az.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = az && az.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = az && az.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "simvol", verb: "olmalıdır" },
        file: { unit: "bayt", verb: "olmalıdır" },
        array: { unit: "element", verb: "olmalıdır" },
        set: { unit: "element", verb: "olmalıdır" },
        map: { unit: "element", verb: "olmalıdır" }
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
        credit_card: "kredit kartı nömrəsi",
        currency_code: "valyuta kodu",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "input"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Yanlış dəyər: gözlənilən instanceof ${issue.expected}, daxil olan ${received}`;
            }
            return `Yanlış dəyər: gözlənilən ${expected}, daxil olan ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Yanlış dəyər: gözlənilən ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Yanlış seçim: aşağıdakılardan biri olmalıdır: ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Çox böyük: gözlənilən ${issue.origin ?? "dəyər"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "element"}`;
            return `Çox böyük: gözlənilən ${issue.origin ?? "dəyər"} ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Çox kiçik: gözlənilən ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            return `Çox kiçik: gözlənilən ${issue.origin} ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Yanlış mətn: "${_issue.prefix}" ilə başlamalıdır`;
            if (_issue.format === "ends_with")
              return `Yanlış mətn: "${_issue.suffix}" ilə bitməlidir`;
            if (_issue.format === "includes")
              return `Yanlış mətn: "${_issue.includes}" daxil olmalıdır`;
            if (_issue.format === "regex")
              return `Yanlış mətn: ${_issue.pattern} şablonuna uyğun olmalıdır`;
            return `Yanlış ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Yanlış ədəd: ${issue.divisor} ilə bölünə bilən olmalıdır`;
          case "unrecognized_keys":
            return `Tanınmayan açar${issue.keys.length > 1 ? "lar" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `${issue.origin} daxilində yanlış açar`;
          case "invalid_union":
            return "Yanlış dəyər";
          case "invalid_element":
            return `${issue.origin} daxilində yanlış dəyər`;
          default:
            return `Yanlış dəyər`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(az$1, az$1.exports);
  return az$1.exports;
}
var be$1 = { exports: {} };
var be = be$1.exports;
var hasRequiredBe;
function requireBe() {
  if (hasRequiredBe) return be$1.exports;
  hasRequiredBe = 1;
  (function(module2, exports2) {
    var __createBinding = be && be.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = be && be.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = be && be.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    function getBelarusianPlural(count, one, few, many) {
      const absCount = Math.abs(count);
      const lastDigit = absCount % 10;
      const lastTwoDigits = absCount % 100;
      if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
        return many;
      }
      if (lastDigit === 1) {
        return one;
      }
      if (lastDigit >= 2 && lastDigit <= 4) {
        return few;
      }
      return many;
    }
    const error = () => {
      const Sizable = {
        string: {
          unit: {
            one: "сімвал",
            few: "сімвалы",
            many: "сімвалаў"
          },
          verb: "мець"
        },
        array: {
          unit: {
            one: "элемент",
            few: "элементы",
            many: "элементаў"
          },
          verb: "мець"
        },
        set: {
          unit: {
            one: "элемент",
            few: "элементы",
            many: "элементаў"
          },
          verb: "мець"
        },
        map: {
          unit: {
            one: "элемент",
            few: "элементы",
            many: "элементаў"
          },
          verb: "мець"
        },
        file: {
          unit: {
            one: "байт",
            few: "байты",
            many: "байтаў"
          },
          verb: "мець"
        }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "увод",
        email: "email адрас",
        url: "URL",
        emoji: "эмодзі",
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
        datetime: "ISO дата і час",
        date: "ISO дата",
        time: "ISO час",
        duration: "ISO працягласць",
        ipv4: "IPv4 адрас",
        ipv6: "IPv6 адрас",
        mac: "MAC адрас",
        cidrv4: "IPv4 дыяпазон",
        cidrv6: "IPv6 дыяпазон",
        base64: "радок у фармаце base64",
        base64url: "радок у фармаце base64url",
        json_string: "JSON радок",
        e164: "нумар E.164",
        credit_card: "нумар крэдытнай карты",
        currency_code: "код валюты",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "увод"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "лік",
        array: "масіў"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Няправільны ўвод: чакаўся instanceof ${issue.expected}, атрымана ${received}`;
            }
            return `Няправільны ўвод: чакаўся ${expected}, атрымана ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Няправільны ўвод: чакалася ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Няправільны варыянт: чакаўся адзін з ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              const maxValue = Number(issue.maximum);
              const unit = getBelarusianPlural(maxValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
              return `Занадта вялікі: чакалася, што ${issue.origin ?? "значэнне"} павінна ${sizing.verb} ${adj}${issue.maximum.toString()} ${unit}`;
            }
            return `Занадта вялікі: чакалася, што ${issue.origin ?? "значэнне"} павінна быць ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              const minValue = Number(issue.minimum);
              const unit = getBelarusianPlural(minValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
              return `Занадта малы: чакалася, што ${issue.origin} павінна ${sizing.verb} ${adj}${issue.minimum.toString()} ${unit}`;
            }
            return `Занадта малы: чакалася, што ${issue.origin} павінна быць ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Няправільны радок: павінен пачынацца з "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Няправільны радок: павінен заканчвацца на "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Няправільны радок: павінен змяшчаць "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Няправільны радок: павінен адпавядаць шаблону ${_issue.pattern}`;
            return `Няправільны ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Няправільны лік: павінен быць кратным ${issue.divisor}`;
          case "unrecognized_keys":
            return `Нераспазнаны ${issue.keys.length > 1 ? "ключы" : "ключ"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Няправільны ключ у ${issue.origin}`;
          case "invalid_union":
            return "Няправільны ўвод";
          case "invalid_element":
            return `Няправільнае значэнне ў ${issue.origin}`;
          default:
            return `Няправільны ўвод`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(be$1, be$1.exports);
  return be$1.exports;
}
var bg$1 = { exports: {} };
var bg = bg$1.exports;
var hasRequiredBg;
function requireBg() {
  if (hasRequiredBg) return bg$1.exports;
  hasRequiredBg = 1;
  (function(module2, exports2) {
    var __createBinding = bg && bg.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = bg && bg.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = bg && bg.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "символа", verb: "да съдържа" },
        file: { unit: "байта", verb: "да съдържа" },
        array: { unit: "елемента", verb: "да съдържа" },
        set: { unit: "елемента", verb: "да съдържа" },
        map: { unit: "елемента", verb: "да съдържа" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "вход",
        email: "имейл адрес",
        url: "URL",
        emoji: "емоджи",
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
        datetime: "ISO време",
        date: "ISO дата",
        time: "ISO време",
        duration: "ISO продължителност",
        ipv4: "IPv4 адрес",
        ipv6: "IPv6 адрес",
        mac: "MAC адрес",
        cidrv4: "IPv4 диапазон",
        cidrv6: "IPv6 диапазон",
        base64: "base64-кодиран низ",
        base64url: "base64url-кодиран низ",
        json_string: "JSON низ",
        e164: "E.164 номер",
        credit_card: "номер на кредитна карта",
        currency_code: "код на валута",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "вход"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "число",
        array: "масив"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Невалиден вход: очакван instanceof ${issue.expected}, получен ${received}`;
            }
            return `Невалиден вход: очакван ${expected}, получен ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Невалиден вход: очакван ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Невалидна опция: очаквано едно от ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Твърде голямо: очаква се ${issue.origin ?? "стойност"} да съдържа ${adj}${issue.maximum.toString()} ${sizing.unit ?? "елемента"}`;
            return `Твърде голямо: очаква се ${issue.origin ?? "стойност"} да бъде ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Твърде малко: очаква се ${issue.origin} да съдържа ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Твърде малко: очаква се ${issue.origin} да бъде ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Невалиден низ: трябва да започва с "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Невалиден низ: трябва да завършва с "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Невалиден низ: трябва да включва "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Невалиден низ: трябва да съвпада с ${_issue.pattern}`;
            let invalid_adj = "Невалиден";
            if (_issue.format === "emoji")
              invalid_adj = "Невалидно";
            if (_issue.format === "datetime")
              invalid_adj = "Невалидно";
            if (_issue.format === "date")
              invalid_adj = "Невалидна";
            if (_issue.format === "time")
              invalid_adj = "Невалидно";
            if (_issue.format === "duration")
              invalid_adj = "Невалидна";
            return `${invalid_adj} ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Невалидно число: трябва да бъде кратно на ${issue.divisor}`;
          case "unrecognized_keys":
            return `Неразпознат${issue.keys.length > 1 ? "и" : ""} ключ${issue.keys.length > 1 ? "ове" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Невалиден ключ в ${issue.origin}`;
          case "invalid_union":
            return "Невалиден вход";
          case "invalid_element":
            return `Невалидна стойност в ${issue.origin}`;
          default:
            return `Невалиден вход`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(bg$1, bg$1.exports);
  return bg$1.exports;
}
var bn$1 = { exports: {} };
var bn = bn$1.exports;
var hasRequiredBn;
function requireBn() {
  if (hasRequiredBn) return bn$1.exports;
  hasRequiredBn = 1;
  (function(module2, exports2) {
    var __createBinding = bn && bn.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = bn && bn.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = bn && bn.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "অক্ষর", verb: "থাকতে হবে" },
        file: { unit: "বাইট", verb: "থাকতে হবে" },
        array: { unit: "আইটেম", verb: "থাকতে হবে" },
        set: { unit: "আইটেম", verb: "থাকতে হবে" },
        map: { unit: "এন্ট্রি", verb: "থাকতে হবে" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "ইনপুট",
        email: "ইমেইল ঠিকানা",
        url: "URL",
        emoji: "ইমোজি",
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
        datetime: "ISO তারিখ ও সময়",
        date: "ISO তারিখ",
        time: "ISO সময়",
        duration: "ISO সময়কাল",
        ipv4: "IPv4 ঠিকানা",
        ipv6: "IPv6 ঠিকানা",
        mac: "MAC ঠিকানা",
        cidrv4: "IPv4 রেঞ্জ",
        cidrv6: "IPv6 রেঞ্জ",
        base64: "base64-এনকোডেড স্ট্রিং",
        base64url: "base64url-এনকোডেড স্ট্রিং",
        json_string: "JSON স্ট্রিং",
        e164: "E.164 নম্বর",
        credit_card: "ক্রেডিট কার্ড নম্বর",
        currency_code: "মুদ্রা কোড",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "ইনপুট"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            return `অবৈধ ইনপুট: প্রত্যাশিত ${expected}, প্রাপ্ত ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `অবৈধ ইনপুট: প্রত্যাশিত ${util2.stringifyPrimitive(issue.values[0])}`;
            return `অবৈধ অপশন: ${util2.joinValues(issue.values, " | ")} এর মধ্যে একটি প্রত্যাশিত`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `অনেক বড়: ${issue.origin ?? "মান"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "এলিমেন্ট"} হতে হবে`;
            return `অনেক বড়: ${issue.origin ?? "মান"} ${adj}${issue.maximum.toString()} হতে হবে`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `অনেক ছোট: ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit} হতে হবে`;
            }
            return `অনেক ছোট: ${issue.origin} ${adj}${issue.minimum.toString()} হতে হবে`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `অবৈধ স্ট্রিং: "${_issue.prefix}" দিয়ে শুরু হতে হবে`;
            }
            if (_issue.format === "ends_with")
              return `অবৈধ স্ট্রিং: "${_issue.suffix}" দিয়ে শেষ হতে হবে`;
            if (_issue.format === "includes")
              return `অবৈধ স্ট্রিং: "${_issue.includes}" অন্তর্ভুক্ত থাকতে হবে`;
            if (_issue.format === "regex")
              return `অবৈধ স্ট্রিং: ${_issue.pattern} প্যাটার্ন মিলতে হবে`;
            return `অবৈধ ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `অবৈধ নম্বর: ${issue.divisor} এর গুণিতক হতে হবে`;
          case "unrecognized_keys":
            return `অচেনা কী${issue.keys.length > 1 ? "গুলো" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `${issue.origin} এ অবৈধ কী`;
          case "invalid_union":
            if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
              const opts = issue.options.map((o) => `'${o}'`).join(" | ");
              return `অবৈধ ডিসক্রিমিনেটর মান। প্রত্যাশিত ${opts}`;
            }
            return "অবৈধ ইনপুট";
          case "invalid_element":
            return `${issue.origin} এ অবৈধ মান`;
          default:
            return "অবৈধ ইনপুট";
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(bn$1, bn$1.exports);
  return bn$1.exports;
}
var ca$1 = { exports: {} };
var ca = ca$1.exports;
var hasRequiredCa;
function requireCa() {
  if (hasRequiredCa) return ca$1.exports;
  hasRequiredCa = 1;
  (function(module2, exports2) {
    var __createBinding = ca && ca.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ca && ca.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ca && ca.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "caràcters", verb: "contenir" },
        file: { unit: "bytes", verb: "contenir" },
        array: { unit: "elements", verb: "contenir" },
        set: { unit: "elements", verb: "contenir" },
        map: { unit: "elements", verb: "contenir" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "entrada",
        email: "adreça electrònica",
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
        datetime: "data i hora ISO",
        date: "data ISO",
        time: "hora ISO",
        duration: "durada ISO",
        ipv4: "adreça IPv4",
        ipv6: "adreça IPv6",
        mac: "adreça MAC",
        cidrv4: "rang IPv4",
        cidrv6: "rang IPv6",
        base64: "cadena codificada en base64",
        base64url: "cadena codificada en base64url",
        json_string: "cadena JSON",
        e164: "número E.164",
        credit_card: "número de targeta de crèdit",
        currency_code: "codi de moneda",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "entrada"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Tipus invàlid: s'esperava instanceof ${issue.expected}, s'ha rebut ${received}`;
            }
            return `Tipus invàlid: s'esperava ${expected}, s'ha rebut ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Valor invàlid: s'esperava ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Opció invàlida: s'esperava una de ${util2.joinValues(issue.values, " o ")}`;
          case "too_big": {
            const adj = issue.inclusive ? "com a màxim" : "menys de";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Massa gran: s'esperava que ${issue.origin ?? "el valor"} contingués ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
            return `Massa gran: s'esperava que ${issue.origin ?? "el valor"} fos ${adj} ${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? "com a mínim" : "més de";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Massa petit: s'esperava que ${issue.origin} contingués ${adj} ${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Massa petit: s'esperava que ${issue.origin} fos ${adj} ${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Format invàlid: ha de començar amb "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Format invàlid: ha d'acabar amb "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Format invàlid: ha d'incloure "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Format invàlid: ha de coincidir amb el patró ${_issue.pattern}`;
            return `Format invàlid per a ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Número invàlid: ha de ser múltiple de ${issue.divisor}`;
          case "unrecognized_keys":
            return `Clau${issue.keys.length > 1 ? "s" : ""} no reconeguda${issue.keys.length > 1 ? "s" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Clau invàlida a ${issue.origin}`;
          case "invalid_union":
            return "Entrada invàlida";
          // Could also be "Tipus d'unió invàlid" but "Entrada invàlida" is more general
          case "invalid_element":
            return `Element invàlid a ${issue.origin}`;
          default:
            return `Entrada invàlida`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ca$1, ca$1.exports);
  return ca$1.exports;
}
var ckb$1 = { exports: {} };
var ckb = ckb$1.exports;
var hasRequiredCkb;
function requireCkb() {
  if (hasRequiredCkb) return ckb$1.exports;
  hasRequiredCkb = 1;
  (function(module2, exports2) {
    var __createBinding = ckb && ckb.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ckb && ckb.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ckb && ckb.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "پیت", verb: "بێت" },
        file: { unit: "بایت", verb: "بێت" },
        array: { unit: "دانە", verb: "بێت" },
        set: { unit: "دانە", verb: "بێت" },
        map: { unit: "دانە", verb: "بێت" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "regex",
        email: "ئیمەیڵ",
        url: "بەستەر (URL)",
        emoji: "ئیمۆجی",
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
        datetime: "ڕێکەوت و کات",
        date: "ڕێکەوت",
        time: "کات",
        duration: "ماوە",
        ipv4: "ناونیشانی IPv4",
        ipv6: "ناونیشانی IPv6",
        mac: "ناونیشانی MAC",
        cidrv4: "مەودای IPv4",
        cidrv6: "مەودای IPv6",
        base64: "دەقی base64",
        base64url: "دەقی base64url",
        json_string: "دەقی JSON",
        e164: "ژمارەی E.164",
        credit_card: "ژمارەی کارتی کرێدیت",
        currency_code: "کۆدی دراو",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "تێکردە"
      };
      const TypeDictionary = {
        nan: "NaN",
        string: "نووسین",
        number: "ژمارە",
        boolean: "boolean",
        array: "array",
        object: "object",
        date: "ڕێکەوت",
        integer: "ژمارە",
        float: "ژمارە",
        null: "null",
        undefined: "undefined",
        function: "function",
        symbol: "symbol",
        unknown: "unknown",
        promise: "promise",
        void: "void",
        never: "never",
        map: "map",
        set: "set"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            const postfix = ["ا", "و", "ۆ", "وو", "ە", "ی", "ێ"].some((p) => received.endsWith(p)) ? "یە" : "ە";
            const isEnglish = /^[a-zA-Z]+$/.test(received);
            if (receivedType === "null" || receivedType === "undefined")
              return `داواکراوە`;
            return `چاوەڕوانکراوە ${expected} بێت، بەڵام ${received}${isEnglish ? "" : postfix}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `بەهاکە نادرووستە: چاوەڕوانکراوە ${util2.stringifyPrimitive(issue.values[0])} بێت`;
            return `هەڵبژاردەی نادروست: چاوەڕوانکراوە یەکێک بێت لە ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `پێویستە بە لایەنی زۆرەوە ${issue.maximum.toString()} ${sizing.unit} ${sizing.verb}`;
            return `پێویستە بە لایەنی زۆرەوە ${issue.maximum.toString()} بێت`;
          }
          case "too_small": {
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `پێویستە بە لایەنی کەمەوە ${issue.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
            return `پێویستە بە لایەنی کەمەوە ${issue.minimum.toString()} بێت`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `دەقی نادروست: پێویستە دەستپێبکات بە "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `دەقی نادروست: پێویستە کۆتاییبێت بە "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `دەقی نادروست: پێویستە "${_issue.includes}" لەخۆبگرێت`;
            if (_issue.format === "regex")
              return `دەقی نادروست: پێویستە لەگەڵ پاتێرنی ${_issue.pattern} بگونجێت`;
            return `بەهای ${FormatDictionary[_issue.format] ?? issue.format} نادروستە`;
          }
          case "not_multiple_of":
            return `ژمارەی نادروست: دەبێت چەند هێندە بێت بۆ ${issue.divisor}`;
          case "unrecognized_keys":
            return `کلیلی نەناسراو: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `کلیلی نادروست لە ${issue.origin}`;
          case "invalid_union":
            if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
              const opts = issue.options.map((o) => `'${o}'`).join(" | ");
              return `بەهای نەناسراو هەیە. بەهای چاوەڕوانکراو: ${opts}`;
            }
            return "یەکگرتنی نادروست";
          case "invalid_element":
            return `${issue.origin} بەهاکە نادروستە`;
          default:
            return `تێکردەی نادروست`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ckb$1, ckb$1.exports);
  return ckb$1.exports;
}
var cs$1 = { exports: {} };
var cs = cs$1.exports;
var hasRequiredCs;
function requireCs() {
  if (hasRequiredCs) return cs$1.exports;
  hasRequiredCs = 1;
  (function(module2, exports2) {
    var __createBinding = cs && cs.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = cs && cs.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = cs && cs.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "znaků", verb: "mít" },
        file: { unit: "bajtů", verb: "mít" },
        array: { unit: "prvků", verb: "mít" },
        set: { unit: "prvků", verb: "mít" },
        map: { unit: "prvků", verb: "mít" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "regulární výraz",
        email: "e-mailová adresa",
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
        datetime: "datum a čas ve formátu ISO",
        date: "datum ve formátu ISO",
        time: "čas ve formátu ISO",
        duration: "doba trvání ISO",
        ipv4: "IPv4 adresa",
        ipv6: "IPv6 adresa",
        mac: "MAC adresa",
        cidrv4: "rozsah IPv4",
        cidrv6: "rozsah IPv6",
        base64: "řetězec zakódovaný ve formátu base64",
        base64url: "řetězec zakódovaný ve formátu base64url",
        json_string: "řetězec ve formátu JSON",
        e164: "číslo E.164",
        credit_card: "číslo kreditní karty",
        currency_code: "kód měny",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "vstup"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "číslo",
        string: "řetězec",
        function: "funkce",
        array: "pole"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Neplatný vstup: očekáváno instanceof ${issue.expected}, obdrženo ${received}`;
            }
            return `Neplatný vstup: očekáváno ${expected}, obdrženo ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Neplatný vstup: očekáváno ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Neplatná možnost: očekávána jedna z hodnot ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Hodnota je příliš velká: ${issue.origin ?? "hodnota"} musí mít ${adj}${issue.maximum.toString()} ${sizing.unit ?? "prvků"}`;
            }
            return `Hodnota je příliš velká: ${issue.origin ?? "hodnota"} musí být ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Hodnota je příliš malá: ${issue.origin ?? "hodnota"} musí mít ${adj}${issue.minimum.toString()} ${sizing.unit ?? "prvků"}`;
            }
            return `Hodnota je příliš malá: ${issue.origin ?? "hodnota"} musí být ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Neplatný řetězec: musí začínat na "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Neplatný řetězec: musí končit na "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Neplatný řetězec: musí obsahovat "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Neplatný řetězec: musí odpovídat vzoru ${_issue.pattern}`;
            return `Neplatný formát ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Neplatné číslo: musí být násobkem ${issue.divisor}`;
          case "unrecognized_keys":
            return `Neznámé klíče: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Neplatný klíč v ${issue.origin}`;
          case "invalid_union":
            return "Neplatný vstup";
          case "invalid_element":
            return `Neplatná hodnota v ${issue.origin}`;
          default:
            return `Neplatný vstup`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(cs$1, cs$1.exports);
  return cs$1.exports;
}
var da$1 = { exports: {} };
var da = da$1.exports;
var hasRequiredDa;
function requireDa() {
  if (hasRequiredDa) return da$1.exports;
  hasRequiredDa = 1;
  (function(module2, exports2) {
    var __createBinding = da && da.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = da && da.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = da && da.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "tegn", verb: "havde" },
        file: { unit: "bytes", verb: "havde" },
        array: { unit: "elementer", verb: "indeholdt" },
        set: { unit: "elementer", verb: "indeholdt" },
        map: { unit: "elementer", verb: "indeholdt" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "input",
        email: "e-mailadresse",
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
        datetime: "ISO dato- og klokkeslæt",
        date: "ISO-dato",
        time: "ISO-klokkeslæt",
        duration: "ISO-varighed",
        ipv4: "IPv4-adresse",
        ipv6: "IPv6-adresse",
        mac: "MAC-adresse",
        cidrv4: "IPv4-spektrum",
        cidrv6: "IPv6-spektrum",
        base64: "base64-kodet streng",
        base64url: "base64url-kodet streng",
        json_string: "JSON-streng",
        e164: "E.164-nummer",
        credit_card: "kreditkortnummer",
        currency_code: "valutakode",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "input"
      };
      const TypeDictionary = {
        nan: "NaN",
        string: "streng",
        number: "tal",
        boolean: "boolean",
        array: "liste",
        object: "objekt",
        set: "sæt",
        file: "fil"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Ugyldigt input: forventede instanceof ${issue.expected}, fik ${received}`;
            }
            return `Ugyldigt input: forventede ${expected}, fik ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Ugyldig værdi: forventede ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Ugyldigt valg: forventede en af følgende ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            const origin2 = TypeDictionary[issue.origin] ?? issue.origin;
            if (sizing)
              return `For stor: forventede ${origin2 ?? "value"} ${sizing.verb} ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "elementer"}`;
            return `For stor: forventede ${origin2 ?? "value"} havde ${adj} ${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            const origin2 = TypeDictionary[issue.origin] ?? issue.origin;
            if (sizing) {
              return `For lille: forventede ${origin2} ${sizing.verb} ${adj} ${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `For lille: forventede ${origin2} havde ${adj} ${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Ugyldig streng: skal starte med "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Ugyldig streng: skal ende med "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Ugyldig streng: skal indeholde "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Ugyldig streng: skal matche mønsteret ${_issue.pattern}`;
            return `Ugyldig ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Ugyldigt tal: skal være deleligt med ${issue.divisor}`;
          case "unrecognized_keys":
            return `${issue.keys.length > 1 ? "Ukendte nøgler" : "Ukendt nøgle"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Ugyldig nøgle i ${issue.origin}`;
          case "invalid_union":
            return "Ugyldigt input: matcher ingen af de tilladte typer";
          case "invalid_element":
            return `Ugyldig værdi i ${issue.origin}`;
          default:
            return `Ugyldigt input`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(da$1, da$1.exports);
  return da$1.exports;
}
var de$1 = { exports: {} };
var de = de$1.exports;
var hasRequiredDe;
function requireDe() {
  if (hasRequiredDe) return de$1.exports;
  hasRequiredDe = 1;
  (function(module2, exports2) {
    var __createBinding = de && de.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = de && de.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = de && de.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "Zeichen", verb: "zu haben" },
        file: { unit: "Bytes", verb: "zu haben" },
        array: { unit: "Elemente", verb: "zu haben" },
        set: { unit: "Elemente", verb: "zu haben" },
        map: { unit: "Elemente", verb: "zu haben" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "Eingabe",
        email: "E-Mail-Adresse",
        url: "URL",
        emoji: "Emoji",
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
        datetime: "ISO-Datum und -Uhrzeit",
        date: "ISO-Datum",
        time: "ISO-Uhrzeit",
        duration: "ISO-Dauer",
        ipv4: "IPv4-Adresse",
        ipv6: "IPv6-Adresse",
        mac: "MAC-Adresse",
        cidrv4: "IPv4-Bereich",
        cidrv6: "IPv6-Bereich",
        base64: "Base64-codierter String",
        base64url: "Base64-URL-codierter String",
        json_string: "JSON-String",
        e164: "E.164-Nummer",
        credit_card: "Kreditkartennummer",
        currency_code: "Währungscode",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "Eingabe"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "Zahl",
        array: "Array"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Ungültige Eingabe: erwartet instanceof ${issue.expected}, erhalten ${received}`;
            }
            return `Ungültige Eingabe: erwartet ${expected}, erhalten ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Ungültige Eingabe: erwartet ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Ungültige Option: erwartet eine von ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Zu groß: erwartet, dass ${issue.origin ?? "Wert"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "Elemente"} hat`;
            return `Zu groß: erwartet, dass ${issue.origin ?? "Wert"} ${adj}${issue.maximum.toString()} ist`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Zu klein: erwartet, dass ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit} hat`;
            }
            return `Zu klein: erwartet, dass ${issue.origin} ${adj}${issue.minimum.toString()} ist`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Ungültiger String: muss mit "${_issue.prefix}" beginnen`;
            if (_issue.format === "ends_with")
              return `Ungültiger String: muss mit "${_issue.suffix}" enden`;
            if (_issue.format === "includes")
              return `Ungültiger String: muss "${_issue.includes}" enthalten`;
            if (_issue.format === "regex")
              return `Ungültiger String: muss dem Muster ${_issue.pattern} entsprechen`;
            return `Ungültig: ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Ungültige Zahl: muss ein Vielfaches von ${issue.divisor} sein`;
          case "unrecognized_keys":
            return `${issue.keys.length > 1 ? "Unbekannte Schlüssel" : "Unbekannter Schlüssel"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Ungültiger Schlüssel in ${issue.origin}`;
          case "invalid_union":
            return "Ungültige Eingabe";
          case "invalid_element":
            return `Ungültiger Wert in ${issue.origin}`;
          default:
            return `Ungültige Eingabe`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(de$1, de$1.exports);
  return de$1.exports;
}
var el$1 = { exports: {} };
var el = el$1.exports;
var hasRequiredEl;
function requireEl() {
  if (hasRequiredEl) return el$1.exports;
  hasRequiredEl = 1;
  (function(module2, exports2) {
    var __createBinding = el && el.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = el && el.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = el && el.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "χαρακτήρες", verb: "να έχει" },
        file: { unit: "bytes", verb: "να έχει" },
        array: { unit: "στοιχεία", verb: "να έχει" },
        set: { unit: "στοιχεία", verb: "να έχει" },
        map: { unit: "καταχωρήσεις", verb: "να έχει" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "είσοδος",
        email: "διεύθυνση email",
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
        datetime: "ISO ημερομηνία και ώρα",
        date: "ISO ημερομηνία",
        time: "ISO ώρα",
        duration: "ISO διάρκεια",
        ipv4: "διεύθυνση IPv4",
        ipv6: "διεύθυνση IPv6",
        mac: "διεύθυνση MAC",
        cidrv4: "εύρος IPv4",
        cidrv6: "εύρος IPv6",
        base64: "συμβολοσειρά κωδικοποιημένη σε base64",
        base64url: "συμβολοσειρά κωδικοποιημένη σε base64url",
        json_string: "συμβολοσειρά JSON",
        e164: "αριθμός E.164",
        credit_card: "αριθμός πιστωτικής κάρτας",
        currency_code: "κωδικός νομίσματος",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "είσοδος"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (typeof issue.expected === "string" && /^[A-Z]/.test(issue.expected)) {
              return `Μη έγκυρη είσοδος: αναμενόταν instanceof ${issue.expected}, λήφθηκε ${received}`;
            }
            return `Μη έγκυρη είσοδος: αναμενόταν ${expected}, λήφθηκε ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Μη έγκυρη είσοδος: αναμενόταν ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Μη έγκυρη επιλογή: αναμενόταν ένα από ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Πολύ μεγάλο: αναμενόταν ${issue.origin ?? "τιμή"} να έχει ${adj}${issue.maximum.toString()} ${sizing.unit ?? "στοιχεία"}`;
            return `Πολύ μεγάλο: αναμενόταν ${issue.origin ?? "τιμή"} να είναι ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Πολύ μικρό: αναμενόταν ${issue.origin} να έχει ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Πολύ μικρό: αναμενόταν ${issue.origin} να είναι ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Μη έγκυρη συμβολοσειρά: πρέπει να ξεκινά με "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Μη έγκυρη συμβολοσειρά: πρέπει να τελειώνει με "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Μη έγκυρη συμβολοσειρά: πρέπει να περιέχει "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Μη έγκυρη συμβολοσειρά: πρέπει να ταιριάζει με το μοτίβο ${_issue.pattern}`;
            return `Μη έγκυρο: ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Μη έγκυρος αριθμός: πρέπει να είναι πολλαπλάσιο του ${issue.divisor}`;
          case "unrecognized_keys":
            return `Άγνωστ${issue.keys.length > 1 ? "α" : "ο"} κλειδ${issue.keys.length > 1 ? "ιά" : "ί"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Μη έγκυρο κλειδί στο ${issue.origin}`;
          case "invalid_union":
            return "Μη έγκυρη είσοδος";
          case "invalid_element":
            return `Μη έγκυρη τιμή στο ${issue.origin}`;
          default:
            return `Μη έγκυρη είσοδος`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(el$1, el$1.exports);
  return el$1.exports;
}
var en$1 = { exports: {} };
var en = en$1.exports;
var hasRequiredEn;
function requireEn() {
  if (hasRequiredEn) return en$1.exports;
  hasRequiredEn = 1;
  (function(module2, exports2) {
    var __createBinding = en && en.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = en && en.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = en && en.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
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
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = getTypeName(issue.expected);
            const receivedType = util2.parsedType(issue.input);
            const received = getTypeName(receivedType, issue.input);
            return `Invalid input: expected ${expected}, received ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Invalid input: expected ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Invalid option: expected one of ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
            return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Invalid string: must start with "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Invalid string: must end with "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Invalid string: must include "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Invalid string: must match pattern ${_issue.pattern}`;
            return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Invalid number: must be a multiple of ${issue.divisor}`;
          case "unrecognized_keys":
            return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Invalid key in ${issue.origin}`;
          case "invalid_union":
            if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
              const opts = issue.options.map((o) => `'${o}'`).join(" | ");
              return `Invalid discriminator value. Expected ${opts}`;
            }
            if (issue.inclusive === false) {
              return "Invalid input: more than one option matched";
            }
            return "Invalid input";
          case "invalid_element":
            return `Invalid value in ${issue.origin}`;
          default:
            return `Invalid input`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(en$1, en$1.exports);
  return en$1.exports;
}
var eo$1 = { exports: {} };
var eo = eo$1.exports;
var hasRequiredEo;
function requireEo() {
  if (hasRequiredEo) return eo$1.exports;
  hasRequiredEo = 1;
  (function(module2, exports2) {
    var __createBinding = eo && eo.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = eo && eo.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = eo && eo.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "karaktrojn", verb: "havi" },
        file: { unit: "bajtojn", verb: "havi" },
        array: { unit: "elementojn", verb: "havi" },
        set: { unit: "elementojn", verb: "havi" },
        map: { unit: "elementojn", verb: "havi" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "enigo",
        email: "retadreso",
        url: "URL",
        emoji: "emoĝio",
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
        datetime: "ISO-datotempo",
        date: "ISO-dato",
        time: "ISO-tempo",
        duration: "ISO-daŭro",
        ipv4: "IPv4-adreso",
        ipv6: "IPv6-adreso",
        mac: "MAC-adreso",
        cidrv4: "IPv4-rango",
        cidrv6: "IPv6-rango",
        base64: "64-ume kodita karaktraro",
        base64url: "URL-64-ume kodita karaktraro",
        json_string: "JSON-karaktraro",
        e164: "E.164-nombro",
        credit_card: "kreditkarta numero",
        currency_code: "valuta kodo",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "enigo"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "nombro",
        array: "tabelo",
        null: "senvalora"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Nevalida enigo: atendiĝis instanceof ${issue.expected}, riceviĝis ${received}`;
            }
            return `Nevalida enigo: atendiĝis ${expected}, riceviĝis ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Nevalida enigo: atendiĝis ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Nevalida opcio: atendiĝis unu el ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Tro granda: atendiĝis ke ${issue.origin ?? "valoro"} havu ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementojn"}`;
            return `Tro granda: atendiĝis ke ${issue.origin ?? "valoro"} havu ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Tro malgranda: atendiĝis ke ${issue.origin} havu ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Tro malgranda: atendiĝis ke ${issue.origin} estu ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Nevalida karaktraro: devas komenciĝi per "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Nevalida karaktraro: devas finiĝi per "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Nevalida karaktraro: devas inkluzivi "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Nevalida karaktraro: devas kongrui kun la modelo ${_issue.pattern}`;
            return `Nevalida ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Nevalida nombro: devas esti oblo de ${issue.divisor}`;
          case "unrecognized_keys":
            return `Nekonata${issue.keys.length > 1 ? "j" : ""} ŝlosilo${issue.keys.length > 1 ? "j" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Nevalida ŝlosilo en ${issue.origin}`;
          case "invalid_union":
            return "Nevalida enigo";
          case "invalid_element":
            return `Nevalida valoro en ${issue.origin}`;
          default:
            return `Nevalida enigo`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(eo$1, eo$1.exports);
  return eo$1.exports;
}
var es$1 = { exports: {} };
var es = es$1.exports;
var hasRequiredEs;
function requireEs() {
  if (hasRequiredEs) return es$1.exports;
  hasRequiredEs = 1;
  (function(module2, exports2) {
    var __createBinding = es && es.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = es && es.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = es && es.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "caracteres", verb: "tener" },
        file: { unit: "bytes", verb: "tener" },
        array: { unit: "elementos", verb: "tener" },
        set: { unit: "elementos", verb: "tener" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "entrada",
        email: "dirección de correo electrónico",
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
        datetime: "fecha y hora ISO",
        date: "fecha ISO",
        time: "hora ISO",
        duration: "duración ISO",
        ipv4: "dirección IPv4",
        ipv6: "dirección IPv6",
        mac: "dirección MAC",
        cidrv4: "rango IPv4",
        cidrv6: "rango IPv6",
        base64: "cadena codificada en base64",
        base64url: "URL codificada en base64",
        json_string: "cadena JSON",
        e164: "número E.164",
        credit_card: "número de tarjeta de crédito",
        currency_code: "código de moneda",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "entrada"
      };
      const TypeDictionary = {
        nan: "NaN",
        string: "texto",
        number: "número",
        boolean: "booleano",
        array: "arreglo",
        object: "objeto",
        set: "conjunto",
        file: "archivo",
        date: "fecha",
        bigint: "número grande",
        symbol: "símbolo",
        undefined: "indefinido",
        null: "nulo",
        function: "función",
        map: "mapa",
        record: "registro",
        tuple: "tupla",
        enum: "enumeración",
        union: "unión",
        literal: "literal",
        promise: "promesa",
        void: "vacío",
        never: "nunca",
        unknown: "desconocido",
        any: "cualquiera"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Entrada inválida: se esperaba instanceof ${issue.expected}, recibido ${received}`;
            }
            return `Entrada inválida: se esperaba ${expected}, recibido ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Entrada inválida: se esperaba ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Opción inválida: se esperaba una de ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            const origin2 = TypeDictionary[issue.origin] ?? issue.origin;
            if (sizing)
              return `Demasiado grande: se esperaba que ${origin2 ?? "valor"} tuviera ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementos"}`;
            return `Demasiado grande: se esperaba que ${origin2 ?? "valor"} fuera ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            const origin2 = TypeDictionary[issue.origin] ?? issue.origin;
            if (sizing) {
              return `Demasiado pequeño: se esperaba que ${origin2} tuviera ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Demasiado pequeño: se esperaba que ${origin2} fuera ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Cadena inválida: debe comenzar con "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Cadena inválida: debe terminar en "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Cadena inválida: debe incluir "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Cadena inválida: debe coincidir con el patrón ${_issue.pattern}`;
            return `Inválido ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Número inválido: debe ser múltiplo de ${issue.divisor}`;
          case "unrecognized_keys":
            return `Llave${issue.keys.length > 1 ? "s" : ""} desconocida${issue.keys.length > 1 ? "s" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Llave inválida en ${TypeDictionary[issue.origin] ?? issue.origin}`;
          case "invalid_union":
            return "Entrada inválida";
          case "invalid_element":
            return `Valor inválido en ${TypeDictionary[issue.origin] ?? issue.origin}`;
          default:
            return `Entrada inválida`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(es$1, es$1.exports);
  return es$1.exports;
}
var fa$1 = { exports: {} };
var fa = fa$1.exports;
var hasRequiredFa;
function requireFa() {
  if (hasRequiredFa) return fa$1.exports;
  hasRequiredFa = 1;
  (function(module2, exports2) {
    var __createBinding = fa && fa.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = fa && fa.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = fa && fa.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "کاراکتر", verb: "داشته باشد" },
        file: { unit: "بایت", verb: "داشته باشد" },
        array: { unit: "آیتم", verb: "داشته باشد" },
        set: { unit: "آیتم", verb: "داشته باشد" },
        map: { unit: "آیتم", verb: "داشته باشد" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "ورودی",
        email: "آدرس ایمیل",
        url: "URL",
        emoji: "ایموجی",
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
        datetime: "تاریخ و زمان ایزو",
        date: "تاریخ ایزو",
        time: "زمان ایزو",
        duration: "مدت زمان ایزو",
        ipv4: "IPv4 آدرس",
        ipv6: "IPv6 آدرس",
        mac: "MAC آدرس",
        cidrv4: "IPv4 دامنه",
        cidrv6: "IPv6 دامنه",
        base64: "base64-encoded رشته",
        base64url: "base64url-encoded رشته",
        json_string: "JSON رشته",
        e164: "E.164 عدد",
        credit_card: "شماره کارت اعتباری",
        currency_code: "کد ارز",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "ورودی"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "عدد",
        array: "آرایه"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `ورودی نامعتبر: می‌بایست instanceof ${issue.expected} می‌بود، ${received} دریافت شد`;
            }
            return `ورودی نامعتبر: می‌بایست ${expected} می‌بود، ${received} دریافت شد`;
          }
          case "invalid_value":
            if (issue.values.length === 1) {
              return `ورودی نامعتبر: می‌بایست ${util2.stringifyPrimitive(issue.values[0])} می‌بود`;
            }
            return `گزینه نامعتبر: می‌بایست یکی از ${util2.joinValues(issue.values, "|")} می‌بود`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `خیلی بزرگ: ${issue.origin ?? "مقدار"} باید ${adj}${issue.maximum.toString()} ${sizing.unit ?? "عنصر"} باشد`;
            }
            return `خیلی بزرگ: ${issue.origin ?? "مقدار"} باید ${adj}${issue.maximum.toString()} باشد`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `خیلی کوچک: ${issue.origin} باید ${adj}${issue.minimum.toString()} ${sizing.unit} باشد`;
            }
            return `خیلی کوچک: ${issue.origin} باید ${adj}${issue.minimum.toString()} باشد`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `رشته نامعتبر: باید با "${_issue.prefix}" شروع شود`;
            }
            if (_issue.format === "ends_with") {
              return `رشته نامعتبر: باید با "${_issue.suffix}" تمام شود`;
            }
            if (_issue.format === "includes") {
              return `رشته نامعتبر: باید شامل "${_issue.includes}" باشد`;
            }
            if (_issue.format === "regex") {
              return `رشته نامعتبر: باید با الگوی ${_issue.pattern} مطابقت داشته باشد`;
            }
            return `${FormatDictionary[_issue.format] ?? issue.format} نامعتبر`;
          }
          case "not_multiple_of":
            return `عدد نامعتبر: باید مضرب ${issue.divisor} باشد`;
          case "unrecognized_keys":
            return `کلید${issue.keys.length > 1 ? "های" : ""} ناشناس: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `کلید ناشناس در ${issue.origin}`;
          case "invalid_union":
            return `ورودی نامعتبر`;
          case "invalid_element":
            return `مقدار نامعتبر در ${issue.origin}`;
          default:
            return `ورودی نامعتبر`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(fa$1, fa$1.exports);
  return fa$1.exports;
}
var fi$1 = { exports: {} };
var fi = fi$1.exports;
var hasRequiredFi;
function requireFi() {
  if (hasRequiredFi) return fi$1.exports;
  hasRequiredFi = 1;
  (function(module2, exports2) {
    var __createBinding = fi && fi.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = fi && fi.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = fi && fi.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "merkkiä", subject: "merkkijonon" },
        file: { unit: "tavua", subject: "tiedoston" },
        array: { unit: "alkiota", subject: "listan" },
        set: { unit: "alkiota", subject: "joukon" },
        map: { unit: "alkiota", subject: "kuvauksen" },
        number: { unit: "", subject: "luvun" },
        bigint: { unit: "", subject: "suuren kokonaisluvun" },
        int: { unit: "", subject: "kokonaisluvun" },
        date: { unit: "", subject: "päivämäärän" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "säännöllinen lauseke",
        email: "sähköpostiosoite",
        url: "URL-osoite",
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
        datetime: "ISO-aikaleima",
        date: "ISO-päivämäärä",
        time: "ISO-aika",
        duration: "ISO-kesto",
        ipv4: "IPv4-osoite",
        ipv6: "IPv6-osoite",
        mac: "MAC-osoite",
        cidrv4: "IPv4-alue",
        cidrv6: "IPv6-alue",
        base64: "base64-koodattu merkkijono",
        base64url: "base64url-koodattu merkkijono",
        json_string: "JSON-merkkijono",
        e164: "E.164-luku",
        credit_card: "luottokortin numero",
        currency_code: "valuuttakoodi",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "templaattimerkkijono"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Virheellinen tyyppi: odotettiin instanceof ${issue.expected}, oli ${received}`;
            }
            return `Virheellinen tyyppi: odotettiin ${expected}, oli ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Virheellinen syöte: täytyy olla ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Virheellinen valinta: täytyy olla yksi seuraavista: ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Liian suuri: ${sizing.subject} täytyy olla ${adj}${issue.maximum.toString()} ${sizing.unit}`.trim();
            }
            return `Liian suuri: arvon täytyy olla ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Liian pieni: ${sizing.subject} täytyy olla ${adj}${issue.minimum.toString()} ${sizing.unit}`.trim();
            }
            return `Liian pieni: arvon täytyy olla ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Virheellinen syöte: täytyy alkaa "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Virheellinen syöte: täytyy loppua "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Virheellinen syöte: täytyy sisältää "${_issue.includes}"`;
            if (_issue.format === "regex") {
              return `Virheellinen syöte: täytyy vastata säännöllistä lauseketta ${_issue.pattern}`;
            }
            return `Virheellinen ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Virheellinen luku: täytyy olla luvun ${issue.divisor} monikerta`;
          case "unrecognized_keys":
            return `${issue.keys.length > 1 ? "Tuntemattomat avaimet" : "Tuntematon avain"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return "Virheellinen avain tietueessa";
          case "invalid_union":
            return "Virheellinen unioni";
          case "invalid_element":
            return "Virheellinen arvo joukossa";
          default:
            return `Virheellinen syöte`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(fi$1, fi$1.exports);
  return fi$1.exports;
}
var fr$1 = { exports: {} };
var fr = fr$1.exports;
var hasRequiredFr;
function requireFr() {
  if (hasRequiredFr) return fr$1.exports;
  hasRequiredFr = 1;
  (function(module2, exports2) {
    var __createBinding = fr && fr.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = fr && fr.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = fr && fr.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "caractères", verb: "avoir" },
        file: { unit: "octets", verb: "avoir" },
        array: { unit: "éléments", verb: "avoir" },
        set: { unit: "éléments", verb: "avoir" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "expression régulière",
        email: "adresse e-mail",
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
        datetime: "date et heure ISO",
        date: "date ISO",
        time: "heure ISO",
        duration: "durée ISO",
        ipv4: "adresse IPv4",
        ipv6: "adresse IPv6",
        mac: "adresse MAC",
        cidrv4: "plage IPv4",
        cidrv6: "plage IPv6",
        base64: "chaîne de caractères encodée en base64",
        base64url: "chaîne de caractères encodée en base64url",
        json_string: "chaîne de caractères JSON",
        e164: "numéro au format E.164",
        credit_card: "numéro de carte de crédit",
        currency_code: "code de devise",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "entrée"
      };
      const TypeDictionary = {
        string: "chaîne de caractères",
        number: "nombre",
        int: "entier",
        boolean: "booléen",
        bigint: "grand entier",
        symbol: "symbole",
        undefined: "indéfini",
        null: "null",
        never: "jamais",
        void: "vide",
        date: "date",
        array: "tableau",
        object: "objet",
        tuple: "tuple",
        record: "record",
        map: "map",
        set: "ensemble",
        file: "fichier",
        nonoptional: "non optionnel",
        nan: "NaN",
        function: "fonction"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Entrée invalide : instance de ${issue.expected} attendu, ${received} reçu`;
            }
            return `Entrée invalide : ${expected} attendu, ${received} reçu`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Entrée invalide : ${util2.stringifyPrimitive(issue.values[0])} attendu`;
            return `Option invalide : une valeur parmi ${util2.joinValues(issue.values, "|")} attendue`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Trop grand : ${TypeDictionary[issue.origin] ?? "valeur"} doit ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "élément(s)"}`;
            return `Trop grand : ${TypeDictionary[issue.origin] ?? "valeur"} doit être ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Trop petit : ${TypeDictionary[issue.origin] ?? "valeur"} doit ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            return `Trop petit : ${TypeDictionary[issue.origin] ?? "valeur"} doit être ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Chaîne de caractères invalide : doit commencer par "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Chaîne de caractères invalide : doit se terminer par "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Chaîne de caractères invalide : doit inclure "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Chaîne de caractères invalide : doit correspondre au motif ${_issue.pattern}`;
            return `${FormatDictionary[_issue.format] ?? issue.format} invalide`;
          }
          case "not_multiple_of":
            return `Nombre invalide : doit être un multiple de ${issue.divisor}`;
          case "unrecognized_keys":
            return `Clé${issue.keys.length > 1 ? "s" : ""} non reconnue${issue.keys.length > 1 ? "s" : ""} : ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Clé invalide dans ${issue.origin}`;
          case "invalid_union":
            return "Entrée invalide";
          case "invalid_element":
            return `Valeur invalide dans ${issue.origin}`;
          default:
            return `Entrée invalide`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(fr$1, fr$1.exports);
  return fr$1.exports;
}
var frCA$1 = { exports: {} };
var frCA = frCA$1.exports;
var hasRequiredFrCA;
function requireFrCA() {
  if (hasRequiredFrCA) return frCA$1.exports;
  hasRequiredFrCA = 1;
  (function(module2, exports2) {
    var __createBinding = frCA && frCA.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = frCA && frCA.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = frCA && frCA.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "caractères", verb: "avoir" },
        file: { unit: "octets", verb: "avoir" },
        array: { unit: "éléments", verb: "avoir" },
        set: { unit: "éléments", verb: "avoir" },
        map: { unit: "éléments", verb: "avoir" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "entrée",
        email: "adresse courriel",
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
        datetime: "date-heure ISO",
        date: "date ISO",
        time: "heure ISO",
        duration: "durée ISO",
        ipv4: "adresse IPv4",
        ipv6: "adresse IPv6",
        mac: "adresse MAC",
        cidrv4: "plage IPv4",
        cidrv6: "plage IPv6",
        base64: "chaîne encodée en base64",
        base64url: "chaîne encodée en base64url",
        json_string: "chaîne JSON",
        e164: "numéro E.164",
        credit_card: "numéro de carte de crédit",
        currency_code: "code de devise",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "entrée"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Entrée invalide : attendu instanceof ${issue.expected}, reçu ${received}`;
            }
            return `Entrée invalide : attendu ${expected}, reçu ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Entrée invalide : attendu ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Option invalide : attendu l'une des valeurs suivantes ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "≤" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Trop grand : attendu que ${issue.origin ?? "la valeur"} ait ${adj}${issue.maximum.toString()} ${sizing.unit}`;
            return `Trop grand : attendu que ${issue.origin ?? "la valeur"} soit ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? "≥" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Trop petit : attendu que ${issue.origin} ait ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Trop petit : attendu que ${issue.origin} soit ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Chaîne invalide : doit commencer par "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Chaîne invalide : doit se terminer par "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Chaîne invalide : doit inclure "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Chaîne invalide : doit correspondre au motif ${_issue.pattern}`;
            return `${FormatDictionary[_issue.format] ?? issue.format} invalide`;
          }
          case "not_multiple_of":
            return `Nombre invalide : doit être un multiple de ${issue.divisor}`;
          case "unrecognized_keys":
            return `Clé${issue.keys.length > 1 ? "s" : ""} non reconnue${issue.keys.length > 1 ? "s" : ""} : ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Clé invalide dans ${issue.origin}`;
          case "invalid_union":
            return "Entrée invalide";
          case "invalid_element":
            return `Valeur invalide dans ${issue.origin}`;
          default:
            return `Entrée invalide`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(frCA$1, frCA$1.exports);
  return frCA$1.exports;
}
var gu$1 = { exports: {} };
var gu = gu$1.exports;
var hasRequiredGu;
function requireGu() {
  if (hasRequiredGu) return gu$1.exports;
  hasRequiredGu = 1;
  (function(module2, exports2) {
    var __createBinding = gu && gu.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = gu && gu.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = gu && gu.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "અક્ષર", verb: "હોવા જોઈએ" },
        file: { unit: "બાયટ", verb: "હોવા જોઈએ" },
        array: { unit: "આઇટમ", verb: "હોવા જોઈએ" },
        set: { unit: "આઇટમ", verb: "હોવા જોઈએ" },
        map: { unit: "એન્ટ્રી", verb: "હોવા જોઈએ" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "ઇનપુટ",
        email: "ઈમેઇલ એડ્રેસ",
        url: "URL",
        emoji: "ઇમોજી",
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
        datetime: "ISO તારીખ અને સમય",
        date: "ISO તારીખ",
        time: "ISO સમય",
        duration: "ISO અવધિ",
        ipv4: "IPv4 એડ્રેસ",
        ipv6: "IPv6 એડ્રેસ",
        mac: "MAC એડ્રેસ",
        cidrv4: "IPv4 શ્રેણી",
        cidrv6: "IPv6 શ્રેણી",
        base64: "base64-એન્કોડેડ સ્ટ્રિંગ",
        base64url: "base64url-એન્કોડેડ સ્ટ્રિંગ",
        json_string: "JSON સ્ટ્રિંગ",
        e164: "E.164 નંબર",
        credit_card: "ક્રેડિટ કાર્ડ નંબર",
        currency_code: "ચલણ કોડ",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "ઇનપુટ"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            return `અમાન્ય ઇનપુટ: અપેક્ષિત ${expected}, પ્રાપ્ત ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `અમાન્ય ઇનપુટ: અપેક્ષિત ${util2.stringifyPrimitive(issue.values[0])}`;
            return `અમાન્ય વિકલ્પ: ${util2.joinValues(issue.values, " | ")} માધ્યમથી એક અપેક્ષિત`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `ખૂબ મોટું: ${issue.origin ?? "મૂલ્ય"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "એલિમેન્ટ"} હોવા જોઈએ`;
            return `ખૂબ મોટું: ${issue.origin ?? "મૂલ્ય"} ${adj}${issue.maximum.toString()} હોવું જોઈએ`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `ખૂબ નાનું: ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit} હોવા જોઈએ`;
            }
            return `ખૂબ નાનું: ${issue.origin} ${adj}${issue.minimum.toString()} હોવું જોઈએ`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `અમાન્ય સ્ટ્રિંગ: "${_issue.prefix}" થી શરૂ થવું જોઈએ`;
            }
            if (_issue.format === "ends_with")
              return `અમાન્ય સ્ટ્રિંગ: "${_issue.suffix}" પર સમાપ્ત થવું જોઈએ`;
            if (_issue.format === "includes")
              return `અમાન્ય સ્ટ્રિંગ: "${_issue.includes}" શામેલ હોવું જોઈએ`;
            if (_issue.format === "regex")
              return `અમાન્ય સ્ટ્રિંગ: પેટર્ન ${_issue.pattern} સાથે મેળ ખાવું જોઈએ`;
            return `અમાન્ય ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `અમાન્ય નંબર: ${issue.divisor} નો ગુણાંક હોવો જોઈએ`;
          case "unrecognized_keys":
            return `ઓળખી શકાતા નહીં તે કી${issue.keys.length > 1 ? "ઓ" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `${issue.origin} માં અમાન્ય કી`;
          case "invalid_union":
            if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
              const opts = issue.options.map((o) => `'${o}'`).join(" | ");
              return `અમાન્ય ડિસ્ક્રિમિનેટર મૂલ્ય. અપેક્ષિત ${opts}`;
            }
            return "અમાન્ય ઇનપુટ";
          case "invalid_element":
            return `${issue.origin} માં અમાન્ય મૂલ્ય`;
          default:
            return "અમાન્ય ઇનપુટ";
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(gu$1, gu$1.exports);
  return gu$1.exports;
}
var he$1 = { exports: {} };
var he = he$1.exports;
var hasRequiredHe;
function requireHe() {
  if (hasRequiredHe) return he$1.exports;
  hasRequiredHe = 1;
  (function(module2, exports2) {
    var __createBinding = he && he.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = he && he.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = he && he.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const TypeNames = {
        string: { label: "מחרוזת", gender: "f" },
        number: { label: "מספר", gender: "m" },
        boolean: { label: "ערך בוליאני", gender: "m" },
        bigint: { label: "BigInt", gender: "m" },
        date: { label: "תאריך", gender: "m" },
        array: { label: "מערך", gender: "m" },
        object: { label: "אובייקט", gender: "m" },
        null: { label: "ערך ריק (null)", gender: "m" },
        undefined: { label: "ערך לא מוגדר (undefined)", gender: "m" },
        symbol: { label: "סימבול (Symbol)", gender: "m" },
        function: { label: "פונקציה", gender: "f" },
        map: { label: "מפה (Map)", gender: "f" },
        set: { label: "קבוצה (Set)", gender: "f" },
        file: { label: "קובץ", gender: "m" },
        promise: { label: "Promise", gender: "m" },
        NaN: { label: "NaN", gender: "m" },
        unknown: { label: "ערך לא ידוע", gender: "m" },
        value: { label: "ערך", gender: "m" }
      };
      const Sizable = {
        string: { unit: "תווים", shortLabel: "קצר", longLabel: "ארוך" },
        file: { unit: "בייטים", shortLabel: "קטן", longLabel: "גדול" },
        array: { unit: "פריטים", shortLabel: "קטן", longLabel: "גדול" },
        set: { unit: "פריטים", shortLabel: "קטן", longLabel: "גדול" },
        number: { unit: "", shortLabel: "קטן", longLabel: "גדול" }
        // no unit
      };
      const typeEntry = (t) => t ? TypeNames[t] : void 0;
      const typeLabel = (t) => {
        const e = typeEntry(t);
        if (e)
          return e.label;
        return t ?? TypeNames.unknown.label;
      };
      const withDefinite = (t) => `ה${typeLabel(t)}`;
      const verbFor = (t) => {
        const e = typeEntry(t);
        const gender = e?.gender ?? "m";
        return gender === "f" ? "צריכה להיות" : "צריך להיות";
      };
      const getSizing = (origin2) => {
        if (!origin2)
          return null;
        return Sizable[origin2] ?? null;
      };
      const FormatDictionary = {
        regex: { label: "קלט", gender: "m" },
        email: { label: "כתובת אימייל", gender: "f" },
        url: { label: "כתובת רשת", gender: "f" },
        emoji: { label: "אימוג'י", gender: "m" },
        uuid: { label: "UUID", gender: "m" },
        uuidv4: { label: "UUIDv4", gender: "m" },
        uuidv6: { label: "UUIDv6", gender: "m" },
        nanoid: { label: "nanoid", gender: "m" },
        guid: { label: "GUID", gender: "m" },
        cuid: { label: "cuid", gender: "m" },
        cuid2: { label: "cuid2", gender: "m" },
        ulid: { label: "ULID", gender: "m" },
        xid: { label: "XID", gender: "m" },
        ksuid: { label: "KSUID", gender: "m" },
        datetime: { label: "תאריך וזמן ISO", gender: "m" },
        date: { label: "תאריך ISO", gender: "m" },
        time: { label: "זמן ISO", gender: "m" },
        duration: { label: "משך זמן ISO", gender: "m" },
        ipv4: { label: "כתובת IPv4", gender: "f" },
        ipv6: { label: "כתובת IPv6", gender: "f" },
        mac: { label: "כתובת MAC", gender: "f" },
        cidrv4: { label: "טווח IPv4", gender: "m" },
        cidrv6: { label: "טווח IPv6", gender: "m" },
        base64: { label: "מחרוזת בבסיס 64", gender: "f" },
        base64url: { label: "מחרוזת בבסיס 64 לכתובות רשת", gender: "f" },
        json_string: { label: "מחרוזת JSON", gender: "f" },
        e164: { label: "מספר E.164", gender: "m" },
        credit_card: { label: "מספר כרטיס אשראי", gender: "m" },
        currency_code: { label: "קוד מטבע", gender: "m" },
        iban: { label: "IBAN", gender: "m" },
        jwt: { label: "JWT", gender: "m" },
        template_literal: { label: "קלט", gender: "m" },
        ends_with: { label: "קלט", gender: "m" },
        includes: { label: "קלט", gender: "m" },
        lowercase: { label: "קלט", gender: "m" },
        starts_with: { label: "קלט", gender: "m" },
        uppercase: { label: "קלט", gender: "m" }
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expectedKey = issue.expected;
            const expected = TypeDictionary[expectedKey ?? ""] ?? typeLabel(expectedKey);
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? TypeNames[receivedType]?.label ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `קלט לא תקין: צריך להיות instanceof ${issue.expected}, התקבל ${received}`;
            }
            return `קלט לא תקין: צריך להיות ${expected}, התקבל ${received}`;
          }
          case "invalid_value": {
            if (issue.values.length === 1) {
              return `ערך לא תקין: הערך חייב להיות ${util2.stringifyPrimitive(issue.values[0])}`;
            }
            const stringified = issue.values.map((v) => util2.stringifyPrimitive(v));
            if (issue.values.length === 2) {
              return `ערך לא תקין: האפשרויות המתאימות הן ${stringified[0]} או ${stringified[1]}`;
            }
            const lastValue = stringified[stringified.length - 1];
            const restValues = stringified.slice(0, -1).join(", ");
            return `ערך לא תקין: האפשרויות המתאימות הן ${restValues} או ${lastValue}`;
          }
          case "too_big": {
            const sizing = getSizing(issue.origin);
            const subject = withDefinite(issue.origin ?? "value");
            if (issue.origin === "string") {
              return `${sizing?.longLabel ?? "ארוך"} מדי: ${subject} צריכה להכיל ${issue.maximum.toString()} ${sizing?.unit ?? ""} ${issue.inclusive ? "או פחות" : "לכל היותר"}`.trim();
            }
            if (issue.origin === "number") {
              const comparison = issue.inclusive ? `קטן או שווה ל-${issue.maximum}` : `קטן מ-${issue.maximum}`;
              return `גדול מדי: ${subject} צריך להיות ${comparison}`;
            }
            if (issue.origin === "array" || issue.origin === "set") {
              const verb = issue.origin === "set" ? "צריכה" : "צריך";
              const comparison = issue.inclusive ? `${issue.maximum} ${sizing?.unit ?? ""} או פחות` : `פחות מ-${issue.maximum} ${sizing?.unit ?? ""}`;
              return `גדול מדי: ${subject} ${verb} להכיל ${comparison}`.trim();
            }
            const adj = issue.inclusive ? "<=" : "<";
            const be2 = verbFor(issue.origin ?? "value");
            if (sizing?.unit) {
              return `${sizing.longLabel} מדי: ${subject} ${be2} ${adj}${issue.maximum.toString()} ${sizing.unit}`;
            }
            return `${sizing?.longLabel ?? "גדול"} מדי: ${subject} ${be2} ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const sizing = getSizing(issue.origin);
            const subject = withDefinite(issue.origin ?? "value");
            if (issue.origin === "string") {
              return `${sizing?.shortLabel ?? "קצר"} מדי: ${subject} צריכה להכיל ${issue.minimum.toString()} ${sizing?.unit ?? ""} ${issue.inclusive ? "או יותר" : "לפחות"}`.trim();
            }
            if (issue.origin === "number") {
              const comparison = issue.inclusive ? `גדול או שווה ל-${issue.minimum}` : `גדול מ-${issue.minimum}`;
              return `קטן מדי: ${subject} צריך להיות ${comparison}`;
            }
            if (issue.origin === "array" || issue.origin === "set") {
              const verb = issue.origin === "set" ? "צריכה" : "צריך";
              if (issue.minimum === 1 && issue.inclusive) {
                const singularPhrase = issue.origin === "set" ? "לפחות פריט אחד" : "לפחות פריט אחד";
                return `קטן מדי: ${subject} ${verb} להכיל ${singularPhrase}`;
              }
              const comparison = issue.inclusive ? `${issue.minimum} ${sizing?.unit ?? ""} או יותר` : `יותר מ-${issue.minimum} ${sizing?.unit ?? ""}`;
              return `קטן מדי: ${subject} ${verb} להכיל ${comparison}`.trim();
            }
            const adj = issue.inclusive ? ">=" : ">";
            const be2 = verbFor(issue.origin ?? "value");
            if (sizing?.unit) {
              return `${sizing.shortLabel} מדי: ${subject} ${be2} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `${sizing?.shortLabel ?? "קטן"} מדי: ${subject} ${be2} ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `המחרוזת חייבת להתחיל ב "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `המחרוזת חייבת להסתיים ב "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `המחרוזת חייבת לכלול "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `המחרוזת חייבת להתאים לתבנית ${_issue.pattern}`;
            const nounEntry = FormatDictionary[_issue.format];
            const noun = nounEntry?.label ?? _issue.format;
            const gender = nounEntry?.gender ?? "m";
            const adjective = gender === "f" ? "תקינה" : "תקין";
            return `${noun} לא ${adjective}`;
          }
          case "not_multiple_of":
            return `מספר לא תקין: חייב להיות מכפלה של ${issue.divisor}`;
          case "unrecognized_keys":
            return `מפתח${issue.keys.length > 1 ? "ות" : ""} לא מזוה${issue.keys.length > 1 ? "ים" : "ה"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key": {
            return `שדה לא תקין באובייקט`;
          }
          case "invalid_union":
            return "קלט לא תקין";
          case "invalid_element": {
            const place = withDefinite(issue.origin ?? "array");
            return `ערך לא תקין ב${place}`;
          }
          default:
            return `קלט לא תקין`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(he$1, he$1.exports);
  return he$1.exports;
}
var hi$1 = { exports: {} };
var hi = hi$1.exports;
var hasRequiredHi;
function requireHi() {
  if (hasRequiredHi) return hi$1.exports;
  hasRequiredHi = 1;
  (function(module2, exports2) {
    var __createBinding = hi && hi.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = hi && hi.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = hi && hi.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "अक्षर", verb: "रखने के लिए" },
        file: { unit: "बाइट्स", verb: "रखने के लिए" },
        array: { unit: "तत्व", verb: "रखने के लिए" },
        set: { unit: "तत्व", verb: "रखने के लिए" },
        map: { unit: "प्रविष्टियाँ", verb: "रखने के लिए" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "इनपुट",
        email: "ईमेल पता",
        url: "URL",
        emoji: "इमोजी",
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
        datetime: "ISO तिथि और समय",
        date: "ISO तिथि",
        time: "ISO समय",
        duration: "ISO अवधि",
        ipv4: "IPv4 पता",
        ipv6: "IPv6 पता",
        mac: "MAC पता",
        cidrv4: "IPv4 श्रेणी",
        cidrv6: "IPv6 श्रेणी",
        base64: "Base64-एन्कोडेड स्ट्रिंग",
        base64url: "Base64URL-एन्कोडेड स्ट्रिंग",
        json_string: "JSON स्ट्रिंग",
        e164: "E.164 संख्या",
        credit_card: "क्रेडिट कार्ड संख्या",
        currency_code: "मुद्रा कोड",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "इनपुट"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            return `अमान्य इनपुट: अपेक्षित ${expected}, प्राप्त ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `अमान्य इनपुट: अपेक्षित ${util2.stringifyPrimitive(issue.values[0])}`;
            return `अमान्य विकल्प: अपेक्षित मानों में से एक ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `बहुत बड़ा: अपेक्षित था कि ${issue.origin ?? "मान"} में ${adj}${issue.maximum} ${sizing.unit} हों`;
            return `बहुत बड़ा: अपेक्षित था कि ${issue.origin ?? "मान"} ${adj}${issue.maximum} हो`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `बहुत छोटा: अपेक्षित था कि ${issue.origin} में ${adj}${issue.minimum} ${sizing.unit} हों`;
            return `बहुत छोटा: अपेक्षित था कि ${issue.origin} ${adj}${issue.minimum} हो`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `अमान्य स्ट्रिंग: "${_issue.prefix}" से शुरू होना चाहिए`;
            if (_issue.format === "ends_with")
              return `अमान्य स्ट्रिंग: "${_issue.suffix}" पर समाप्त होना चाहिए`;
            if (_issue.format === "includes")
              return `अमान्य स्ट्रिंग: इसमें "${_issue.includes}" शामिल होना चाहिए`;
            if (_issue.format === "regex")
              return `अमान्य स्ट्रिंग: पैटर्न ${_issue.pattern} से मेल खाना चाहिए`;
            return `अमान्य ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `अमान्य संख्या: यह ${issue.divisor} का गुणज होना चाहिए`;
          case "unrecognized_keys":
            return `अपरिचित कुंजी${issue.keys.length > 1 ? "याँ" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `अमान्य कुंजी: ${issue.origin} में`;
          case "invalid_union":
            if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
              const opts = issue.options.map((o) => `'${o}'`).join(" | ");
              return `अमान्य डिस्क्रिमिनेटर मान: अपेक्षित ${opts}`;
            }
            return "अमान्य इनपुट";
          case "invalid_element":
            return `अमान्य मान: ${issue.origin} में`;
          default:
            return `अमान्य इनपुट`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(hi$1, hi$1.exports);
  return hi$1.exports;
}
var hr$1 = { exports: {} };
var hr = hr$1.exports;
var hasRequiredHr;
function requireHr() {
  if (hasRequiredHr) return hr$1.exports;
  hasRequiredHr = 1;
  (function(module2, exports2) {
    var __createBinding = hr && hr.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = hr && hr.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = hr && hr.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "znakova", verb: "imati" },
        file: { unit: "bajtova", verb: "imati" },
        array: { unit: "stavki", verb: "imati" },
        set: { unit: "stavki", verb: "imati" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "unos",
        email: "email adresa",
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
        datetime: "ISO datum i vrijeme",
        date: "ISO datum",
        time: "ISO vrijeme",
        duration: "ISO trajanje",
        ipv4: "IPv4 adresa",
        ipv6: "IPv6 adresa",
        mac: "MAC adresa",
        cidrv4: "IPv4 raspon",
        cidrv6: "IPv6 raspon",
        base64: "base64 kodirani tekst",
        base64url: "base64url kodirani tekst",
        json_string: "JSON tekst",
        e164: "E.164 broj",
        credit_card: "broj kreditne kartice",
        currency_code: "kod valute",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "unos"
      };
      const TypeDictionary = {
        nan: "NaN",
        string: "tekst",
        number: "broj",
        boolean: "boolean",
        array: "niz",
        object: "objekt",
        set: "skup",
        file: "datoteka",
        date: "datum",
        bigint: "bigint",
        symbol: "simbol",
        undefined: "undefined",
        null: "null",
        function: "funkcija",
        map: "mapa"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Neispravan unos: očekuje se instanceof ${issue.expected}, a primljeno je ${received}`;
            }
            return `Neispravan unos: očekuje se ${expected}, a primljeno je ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Neispravna vrijednost: očekivano ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Neispravna opcija: očekivano jedno od ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            const origin2 = TypeDictionary[issue.origin] ?? issue.origin;
            if (sizing)
              return `Preveliko: očekivano da ${origin2 ?? "vrijednost"} ima ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elemenata"}`;
            return `Preveliko: očekivano da ${origin2 ?? "vrijednost"} bude ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            const origin2 = TypeDictionary[issue.origin] ?? issue.origin;
            if (sizing) {
              return `Premalo: očekivano da ${origin2} ima ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Premalo: očekivano da ${origin2} bude ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Neispravan tekst: mora započinjati s "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Neispravan tekst: mora završavati s "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Neispravan tekst: mora sadržavati "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Neispravan tekst: mora odgovarati uzorku ${_issue.pattern}`;
            return `Neispravna ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Neispravan broj: mora biti višekratnik od ${issue.divisor}`;
          case "unrecognized_keys":
            return `Neprepoznat${issue.keys.length > 1 ? "i ključevi" : " ključ"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Neispravan ključ u ${TypeDictionary[issue.origin] ?? issue.origin}`;
          case "invalid_union":
            return "Neispravan unos";
          case "invalid_element":
            return `Neispravna vrijednost u ${TypeDictionary[issue.origin] ?? issue.origin}`;
          default:
            return `Neispravan unos`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(hr$1, hr$1.exports);
  return hr$1.exports;
}
var hu$1 = { exports: {} };
var hu = hu$1.exports;
var hasRequiredHu;
function requireHu() {
  if (hasRequiredHu) return hu$1.exports;
  hasRequiredHu = 1;
  (function(module2, exports2) {
    var __createBinding = hu && hu.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = hu && hu.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = hu && hu.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "karakter", verb: "legyen" },
        file: { unit: "byte", verb: "legyen" },
        array: { unit: "elem", verb: "legyen" },
        set: { unit: "elem", verb: "legyen" },
        map: { unit: "elem", verb: "legyen" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "bemenet",
        email: "email cím",
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
        datetime: "ISO időbélyeg",
        date: "ISO dátum",
        time: "ISO idő",
        duration: "ISO időintervallum",
        ipv4: "IPv4 cím",
        ipv6: "IPv6 cím",
        mac: "MAC cím",
        cidrv4: "IPv4 tartomány",
        cidrv6: "IPv6 tartomány",
        base64: "base64-kódolt string",
        base64url: "base64url-kódolt string",
        json_string: "JSON string",
        e164: "E.164 szám",
        credit_card: "hitelkártyaszám",
        currency_code: "pénznemkód",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "bemenet"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "szám",
        array: "tömb"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Érvénytelen bemenet: a várt érték instanceof ${issue.expected}, a kapott érték ${received}`;
            }
            return `Érvénytelen bemenet: a várt érték ${expected}, a kapott érték ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Érvénytelen bemenet: a várt érték ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Érvénytelen opció: valamelyik érték várt ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Túl nagy: ${issue.origin ?? "érték"} mérete túl nagy ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elem"}`;
            return `Túl nagy: a bemeneti érték ${issue.origin ?? "érték"} túl nagy: ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Túl kicsi: a bemeneti érték ${issue.origin} mérete túl kicsi ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Túl kicsi: a bemeneti érték ${issue.origin} túl kicsi ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Érvénytelen string: "${_issue.prefix}" értékkel kell kezdődnie`;
            if (_issue.format === "ends_with")
              return `Érvénytelen string: "${_issue.suffix}" értékkel kell végződnie`;
            if (_issue.format === "includes")
              return `Érvénytelen string: "${_issue.includes}" értéket kell tartalmaznia`;
            if (_issue.format === "regex")
              return `Érvénytelen string: ${_issue.pattern} mintának kell megfelelnie`;
            return `Érvénytelen ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Érvénytelen szám: ${issue.divisor} többszörösének kell lennie`;
          case "unrecognized_keys":
            return `Ismeretlen kulcs${issue.keys.length > 1 ? "s" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Érvénytelen kulcs ${issue.origin}`;
          case "invalid_union":
            return "Érvénytelen bemenet";
          case "invalid_element":
            return `Érvénytelen érték: ${issue.origin}`;
          default:
            return `Érvénytelen bemenet`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(hu$1, hu$1.exports);
  return hu$1.exports;
}
var hy$1 = { exports: {} };
var hy = hy$1.exports;
var hasRequiredHy;
function requireHy() {
  if (hasRequiredHy) return hy$1.exports;
  hasRequiredHy = 1;
  (function(module2, exports2) {
    var __createBinding = hy && hy.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = hy && hy.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = hy && hy.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    function getArmenianPlural(count, one, many) {
      return Math.abs(count) === 1 ? one : many;
    }
    function withDefiniteArticle(word) {
      if (!word)
        return "";
      const vowels = ["ա", "ե", "ը", "ի", "ո", "ու", "օ"];
      const lastChar = word[word.length - 1];
      return word + (vowels.includes(lastChar) ? "ն" : "ը");
    }
    const error = () => {
      const Sizable = {
        string: {
          unit: {
            one: "նշան",
            many: "նշաններ"
          },
          verb: "ունենալ"
        },
        file: {
          unit: {
            one: "բայթ",
            many: "բայթեր"
          },
          verb: "ունենալ"
        },
        array: {
          unit: {
            one: "տարր",
            many: "տարրեր"
          },
          verb: "ունենալ"
        },
        set: {
          unit: {
            one: "տարր",
            many: "տարրեր"
          },
          verb: "ունենալ"
        },
        map: {
          unit: {
            one: "տարր",
            many: "տարրեր"
          },
          verb: "ունենալ"
        }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "մուտք",
        email: "էլ. հասցե",
        url: "URL",
        emoji: "էմոջի",
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
        datetime: "ISO ամսաթիվ և ժամ",
        date: "ISO ամսաթիվ",
        time: "ISO ժամ",
        duration: "ISO տևողություն",
        ipv4: "IPv4 հասցե",
        ipv6: "IPv6 հասցե",
        mac: "MAC հասցե",
        cidrv4: "IPv4 միջակայք",
        cidrv6: "IPv6 միջակայք",
        base64: "base64 ձևաչափով տող",
        base64url: "base64url ձևաչափով տող",
        json_string: "JSON տող",
        e164: "E.164 համար",
        credit_card: "կրեդիտ քարտի համար",
        currency_code: "արժույթի կոդ",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "մուտք"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "թիվ",
        array: "զանգված"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Սխալ մուտքագրում․ սպասվում էր instanceof ${issue.expected}, ստացվել է ${received}`;
            }
            return `Սխալ մուտքագրում․ սպասվում էր ${expected}, ստացվել է ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Սխալ մուտքագրում․ սպասվում էր ${util2.stringifyPrimitive(issue.values[1])}`;
            return `Սխալ տարբերակ․ սպասվում էր հետևյալներից մեկը՝ ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              const maxValue = Number(issue.maximum);
              const unit = getArmenianPlural(maxValue, sizing.unit.one, sizing.unit.many);
              return `Չափազանց մեծ արժեք․ սպասվում է, որ ${withDefiniteArticle(issue.origin ?? "արժեք")} կունենա ${adj}${issue.maximum.toString()} ${unit}`;
            }
            return `Չափազանց մեծ արժեք․ սպասվում է, որ ${withDefiniteArticle(issue.origin ?? "արժեք")} լինի ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              const minValue = Number(issue.minimum);
              const unit = getArmenianPlural(minValue, sizing.unit.one, sizing.unit.many);
              return `Չափազանց փոքր արժեք․ սպասվում է, որ ${withDefiniteArticle(issue.origin)} կունենա ${adj}${issue.minimum.toString()} ${unit}`;
            }
            return `Չափազանց փոքր արժեք․ սպասվում է, որ ${withDefiniteArticle(issue.origin)} լինի ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Սխալ տող․ պետք է սկսվի "${_issue.prefix}"-ով`;
            if (_issue.format === "ends_with")
              return `Սխալ տող․ պետք է ավարտվի "${_issue.suffix}"-ով`;
            if (_issue.format === "includes")
              return `Սխալ տող․ պետք է պարունակի "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Սխալ տող․ պետք է համապատասխանի ${_issue.pattern} ձևաչափին`;
            return `Սխալ ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Սխալ թիվ․ պետք է բազմապատիկ լինի ${issue.divisor}-ի`;
          case "unrecognized_keys":
            return `Չճանաչված բանալի${issue.keys.length > 1 ? "ներ" : ""}. ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Սխալ բանալի ${withDefiniteArticle(issue.origin)}-ում`;
          case "invalid_union":
            return "Սխալ մուտքագրում";
          case "invalid_element":
            return `Սխալ արժեք ${withDefiniteArticle(issue.origin)}-ում`;
          default:
            return `Սխալ մուտքագրում`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(hy$1, hy$1.exports);
  return hy$1.exports;
}
var id$1 = { exports: {} };
var id = id$1.exports;
var hasRequiredId;
function requireId() {
  if (hasRequiredId) return id$1.exports;
  hasRequiredId = 1;
  (function(module2, exports2) {
    var __createBinding = id && id.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = id && id.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = id && id.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "karakter", verb: "memiliki" },
        file: { unit: "byte", verb: "memiliki" },
        array: { unit: "item", verb: "memiliki" },
        set: { unit: "item", verb: "memiliki" },
        map: { unit: "item", verb: "memiliki" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "input",
        email: "alamat email",
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
        datetime: "tanggal dan waktu format ISO",
        date: "tanggal format ISO",
        time: "jam format ISO",
        duration: "durasi format ISO",
        ipv4: "alamat IPv4",
        ipv6: "alamat IPv6",
        mac: "alamat MAC",
        cidrv4: "rentang alamat IPv4",
        cidrv6: "rentang alamat IPv6",
        base64: "string dengan enkode base64",
        base64url: "string dengan enkode base64url",
        json_string: "string JSON",
        e164: "angka E.164",
        credit_card: "nomor kartu kredit",
        currency_code: "kode mata uang",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "input"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Input tidak valid: diharapkan instanceof ${issue.expected}, diterima ${received}`;
            }
            return `Input tidak valid: diharapkan ${expected}, diterima ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Input tidak valid: diharapkan ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Pilihan tidak valid: diharapkan salah satu dari ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Terlalu besar: diharapkan ${issue.origin ?? "value"} memiliki ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elemen"}`;
            return `Terlalu besar: diharapkan ${issue.origin ?? "value"} menjadi ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Terlalu kecil: diharapkan ${issue.origin} memiliki ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Terlalu kecil: diharapkan ${issue.origin} menjadi ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `String tidak valid: harus dimulai dengan "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `String tidak valid: harus berakhir dengan "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `String tidak valid: harus menyertakan "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `String tidak valid: harus sesuai pola ${_issue.pattern}`;
            return `${FormatDictionary[_issue.format] ?? issue.format} tidak valid`;
          }
          case "not_multiple_of":
            return `Angka tidak valid: harus kelipatan dari ${issue.divisor}`;
          case "unrecognized_keys":
            return `Kunci tidak dikenali ${issue.keys.length > 1 ? "s" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Kunci tidak valid di ${issue.origin}`;
          case "invalid_union":
            return "Input tidak valid";
          case "invalid_element":
            return `Nilai tidak valid di ${issue.origin}`;
          default:
            return `Input tidak valid`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(id$1, id$1.exports);
  return id$1.exports;
}
var is$1 = { exports: {} };
var is = is$1.exports;
var hasRequiredIs;
function requireIs() {
  if (hasRequiredIs) return is$1.exports;
  hasRequiredIs = 1;
  (function(module2, exports2) {
    var __createBinding = is && is.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = is && is.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = is && is.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "stafi", verb: "að hafa" },
        file: { unit: "bæti", verb: "að hafa" },
        array: { unit: "hluti", verb: "að hafa" },
        set: { unit: "hluti", verb: "að hafa" },
        map: { unit: "hluti", verb: "að hafa" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "gildi",
        email: "netfang",
        url: "vefslóð",
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
        datetime: "ISO dagsetning og tími",
        date: "ISO dagsetning",
        time: "ISO tími",
        duration: "ISO tímalengd",
        ipv4: "IPv4 address",
        ipv6: "IPv6 address",
        mac: "MAC address",
        cidrv4: "IPv4 range",
        cidrv6: "IPv6 range",
        base64: "base64-encoded strengur",
        base64url: "base64url-encoded strengur",
        json_string: "JSON strengur",
        e164: "E.164 tölugildi",
        credit_card: "kreditkortanúmer",
        currency_code: "gjaldmiðilskóði",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "gildi"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "númer",
        array: "fylki"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Rangt gildi: Þú slóst inn ${received} þar sem á að vera instanceof ${issue.expected}`;
            }
            return `Rangt gildi: Þú slóst inn ${received} þar sem á að vera ${expected}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Rangt gildi: gert ráð fyrir ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Ógilt val: má vera eitt af eftirfarandi ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Of stórt: gert er ráð fyrir að ${issue.origin ?? "gildi"} hafi ${adj}${issue.maximum.toString()} ${sizing.unit ?? "hluti"}`;
            return `Of stórt: gert er ráð fyrir að ${issue.origin ?? "gildi"} sé ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Of lítið: gert er ráð fyrir að ${issue.origin} hafi ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Of lítið: gert er ráð fyrir að ${issue.origin} sé ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Ógildur strengur: verður að byrja á "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Ógildur strengur: verður að enda á "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Ógildur strengur: verður að innihalda "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Ógildur strengur: verður að fylgja mynstri ${_issue.pattern}`;
            return `Rangt ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Röng tala: verður að vera margfeldi af ${issue.divisor}`;
          case "unrecognized_keys":
            return `Óþekkt ${issue.keys.length > 1 ? "ir lyklar" : "ur lykill"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Rangur lykill í ${issue.origin}`;
          case "invalid_union":
            return "Rangt gildi";
          case "invalid_element":
            return `Rangt gildi í ${issue.origin}`;
          default:
            return `Rangt gildi`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(is$1, is$1.exports);
  return is$1.exports;
}
var it$1 = { exports: {} };
var it = it$1.exports;
var hasRequiredIt;
function requireIt() {
  if (hasRequiredIt) return it$1.exports;
  hasRequiredIt = 1;
  (function(module2, exports2) {
    var __createBinding = it && it.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = it && it.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = it && it.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "caratteri", verb: "avere" },
        file: { unit: "byte", verb: "avere" },
        array: { unit: "elementi", verb: "avere" },
        set: { unit: "elementi", verb: "avere" },
        map: { unit: "elementi", verb: "avere" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "input",
        email: "indirizzo email",
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
        datetime: "data e ora ISO",
        date: "data ISO",
        time: "ora ISO",
        duration: "durata ISO",
        ipv4: "indirizzo IPv4",
        ipv6: "indirizzo IPv6",
        mac: "indirizzo MAC",
        cidrv4: "intervallo IPv4",
        cidrv6: "intervallo IPv6",
        base64: "stringa codificata in base64",
        base64url: "URL codificata in base64",
        json_string: "stringa JSON",
        e164: "numero E.164",
        credit_card: "numero di carta di credito",
        currency_code: "codice valuta",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "input"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "numero",
        array: "vettore"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Input non valido: atteso instanceof ${issue.expected}, ricevuto ${received}`;
            }
            return `Input non valido: atteso ${expected}, ricevuto ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Input non valido: atteso ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Opzione non valida: atteso uno tra ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Troppo grande: ${issue.origin ?? "valore"} deve avere ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementi"}`;
            return `Troppo grande: ${issue.origin ?? "valore"} deve essere ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Troppo piccolo: ${issue.origin} deve avere ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Troppo piccolo: ${issue.origin} deve essere ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Stringa non valida: deve iniziare con "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Stringa non valida: deve terminare con "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Stringa non valida: deve includere "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Stringa non valida: deve corrispondere al pattern ${_issue.pattern}`;
            return `Input non valido: ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Numero non valido: deve essere un multiplo di ${issue.divisor}`;
          case "unrecognized_keys":
            return `Chiav${issue.keys.length > 1 ? "i" : "e"} non riconosciut${issue.keys.length > 1 ? "e" : "a"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Chiave non valida in ${issue.origin}`;
          case "invalid_union":
            return "Input non valido";
          case "invalid_element":
            return `Valore non valido in ${issue.origin}`;
          default:
            return `Input non valido`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(it$1, it$1.exports);
  return it$1.exports;
}
var ja$1 = { exports: {} };
var ja = ja$1.exports;
var hasRequiredJa;
function requireJa() {
  if (hasRequiredJa) return ja$1.exports;
  hasRequiredJa = 1;
  (function(module2, exports2) {
    var __createBinding = ja && ja.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ja && ja.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ja && ja.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "文字", verb: "である" },
        file: { unit: "バイト", verb: "である" },
        array: { unit: "要素", verb: "である" },
        set: { unit: "要素", verb: "である" },
        map: { unit: "要素", verb: "である" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "入力値",
        email: "メールアドレス",
        url: "URL",
        emoji: "絵文字",
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
        datetime: "ISO日時",
        date: "ISO日付",
        time: "ISO時刻",
        duration: "ISO期間",
        ipv4: "IPv4アドレス",
        ipv6: "IPv6アドレス",
        mac: "MACアドレス",
        cidrv4: "IPv4範囲",
        cidrv6: "IPv6範囲",
        base64: "base64エンコード文字列",
        base64url: "base64urlエンコード文字列",
        json_string: "JSON文字列",
        e164: "E.164番号",
        credit_card: "クレジットカード番号",
        currency_code: "通貨コード",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "入力値"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "数値",
        array: "配列"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `無効な入力: instanceof ${issue.expected}が期待されましたが、${received}が入力されました`;
            }
            return `無効な入力: ${expected}が期待されましたが、${received}が入力されました`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `無効な入力: ${util2.stringifyPrimitive(issue.values[0])}が期待されました`;
            return `無効な選択: ${util2.joinValues(issue.values, "、")}のいずれかである必要があります`;
          case "too_big": {
            const adj = issue.inclusive ? "以下である" : "より小さい";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `大きすぎる値: ${issue.origin ?? "値"}は${issue.maximum.toString()}${sizing.unit ?? "要素"}${adj}必要があります`;
            return `大きすぎる値: ${issue.origin ?? "値"}は${issue.maximum.toString()}${adj}必要があります`;
          }
          case "too_small": {
            const adj = issue.inclusive ? "以上である" : "より大きい";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `小さすぎる値: ${issue.origin}は${issue.minimum.toString()}${sizing.unit}${adj}必要があります`;
            return `小さすぎる値: ${issue.origin}は${issue.minimum.toString()}${adj}必要があります`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `無効な文字列: "${_issue.prefix}"で始まる必要があります`;
            if (_issue.format === "ends_with")
              return `無効な文字列: "${_issue.suffix}"で終わる必要があります`;
            if (_issue.format === "includes")
              return `無効な文字列: "${_issue.includes}"を含む必要があります`;
            if (_issue.format === "regex")
              return `無効な文字列: パターン${_issue.pattern}に一致する必要があります`;
            return `無効な${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `無効な数値: ${issue.divisor}の倍数である必要があります`;
          case "unrecognized_keys":
            return `認識されていないキー${issue.keys.length > 1 ? "群" : ""}: ${util2.joinValues(issue.keys, "、")}`;
          case "invalid_key":
            return `${issue.origin}内の無効なキー`;
          case "invalid_union":
            return "無効な入力";
          case "invalid_element":
            return `${issue.origin}内の無効な値`;
          default:
            return `無効な入力`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ja$1, ja$1.exports);
  return ja$1.exports;
}
var ka$1 = { exports: {} };
var ka = ka$1.exports;
var hasRequiredKa;
function requireKa() {
  if (hasRequiredKa) return ka$1.exports;
  hasRequiredKa = 1;
  (function(module2, exports2) {
    var __createBinding = ka && ka.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ka && ka.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ka && ka.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "სიმბოლო", verb: "უნდა შეიცავდეს" },
        file: { unit: "ბაიტი", verb: "უნდა შეიცავდეს" },
        array: { unit: "ელემენტი", verb: "უნდა შეიცავდეს" },
        set: { unit: "ელემენტი", verb: "უნდა შეიცავდეს" },
        map: { unit: "ელემენტი", verb: "უნდა შეიცავდეს" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "შეყვანა",
        email: "ელ-ფოსტის მისამართი",
        url: "URL",
        emoji: "ემოჯი",
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
        datetime: "თარიღი-დრო",
        date: "თარიღი",
        time: "დრო",
        duration: "ხანგრძლივობა",
        ipv4: "IPv4 მისამართი",
        ipv6: "IPv6 მისამართი",
        mac: "MAC მისამართი",
        cidrv4: "IPv4 დიაპაზონი",
        cidrv6: "IPv6 დიაპაზონი",
        base64: "base64-კოდირებული ველი",
        base64url: "base64url-კოდირებული ველი",
        json_string: "JSON ველი",
        e164: "E.164 ნომერი",
        credit_card: "საკრედიტო ბარათის ნომერი",
        currency_code: "ვალუტის კოდი",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "შეყვანა"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "რიცხვი",
        string: "ველი",
        boolean: "ბულეანი",
        function: "ფუნქცია",
        array: "მასივი"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `არასწორი შეყვანა: მოსალოდნელი instanceof ${issue.expected}, მიღებული ${received}`;
            }
            return `არასწორი შეყვანა: მოსალოდნელი ${expected}, მიღებული ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `არასწორი შეყვანა: მოსალოდნელი ${util2.stringifyPrimitive(issue.values[0])}`;
            return `არასწორი ვარიანტი: მოსალოდნელია ერთ-ერთი ${util2.joinValues(issue.values, "|")}-დან`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `ზედმეტად დიდი: მოსალოდნელი ${issue.origin ?? "მნიშვნელობა"} ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit}`;
            return `ზედმეტად დიდი: მოსალოდნელი ${issue.origin ?? "მნიშვნელობა"} იყოს ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `ზედმეტად პატარა: მოსალოდნელი ${issue.origin} ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `ზედმეტად პატარა: მოსალოდნელი ${issue.origin} იყოს ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `არასწორი ველი: უნდა იწყებოდეს "${_issue.prefix}"-ით`;
            }
            if (_issue.format === "ends_with")
              return `არასწორი ველი: უნდა მთავრდებოდეს "${_issue.suffix}"-ით`;
            if (_issue.format === "includes")
              return `არასწორი ველი: უნდა შეიცავდეს "${_issue.includes}"-ს`;
            if (_issue.format === "regex")
              return `არასწორი ველი: უნდა შეესაბამებოდეს შაბლონს ${_issue.pattern}`;
            return `არასწორი ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `არასწორი რიცხვი: უნდა იყოს ${issue.divisor}-ის ჯერადი`;
          case "unrecognized_keys":
            return `უცნობი გასაღებ${issue.keys.length > 1 ? "ები" : "ი"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `არასწორი გასაღები ${issue.origin}-ში`;
          case "invalid_union":
            return "არასწორი შეყვანა";
          case "invalid_element":
            return `არასწორი მნიშვნელობა ${issue.origin}-ში`;
          default:
            return `არასწორი შეყვანა`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ka$1, ka$1.exports);
  return ka$1.exports;
}
var kh$1 = { exports: {} };
var km$1 = { exports: {} };
var km = km$1.exports;
var hasRequiredKm;
function requireKm() {
  if (hasRequiredKm) return km$1.exports;
  hasRequiredKm = 1;
  (function(module2, exports2) {
    var __createBinding = km && km.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = km && km.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = km && km.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "តួអក្សរ", verb: "គួរមាន" },
        file: { unit: "បៃ", verb: "គួរមាន" },
        array: { unit: "ធាតុ", verb: "គួរមាន" },
        set: { unit: "ធាតុ", verb: "គួរមាន" },
        map: { unit: "ធាតុ", verb: "គួរមាន" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "ទិន្នន័យបញ្ចូល",
        email: "អាសយដ្ឋានអ៊ីមែល",
        url: "URL",
        emoji: "សញ្ញាអារម្មណ៍",
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
        datetime: "កាលបរិច្ឆេទ និងម៉ោង ISO",
        date: "កាលបរិច្ឆេទ ISO",
        time: "ម៉ោង ISO",
        duration: "រយៈពេល ISO",
        ipv4: "អាសយដ្ឋាន IPv4",
        ipv6: "អាសយដ្ឋាន IPv6",
        mac: "អាសយដ្ឋាន MAC",
        cidrv4: "ដែនអាសយដ្ឋាន IPv4",
        cidrv6: "ដែនអាសយដ្ឋាន IPv6",
        base64: "ខ្សែអក្សរអ៊ិកូដ base64",
        base64url: "ខ្សែអក្សរអ៊ិកូដ base64url",
        json_string: "ខ្សែអក្សរ JSON",
        e164: "លេខ E.164",
        credit_card: "លេខប័ណ្ណឥណទាន",
        currency_code: "កូដរូបិយប័ណ្ណ",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "ទិន្នន័យបញ្ចូល"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "លេខ",
        array: "អារេ (Array)",
        null: "គ្មានតម្លៃ (null)"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ instanceof ${issue.expected} ប៉ុន្តែទទួលបាន ${received}`;
            }
            return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ ${expected} ប៉ុន្តែទទួលបាន ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ ${util2.stringifyPrimitive(issue.values[0])}`;
            return `ជម្រើសមិនត្រឹមត្រូវ៖ ត្រូវជាមួយក្នុងចំណោម ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `ធំពេក៖ ត្រូវការ ${issue.origin ?? "តម្លៃ"} ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "ធាតុ"}`;
            return `ធំពេក៖ ត្រូវការ ${issue.origin ?? "តម្លៃ"} ${adj} ${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `តូចពេក៖ ត្រូវការ ${issue.origin} ${adj} ${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `តូចពេក៖ ត្រូវការ ${issue.origin} ${adj} ${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវចាប់ផ្តើមដោយ "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវបញ្ចប់ដោយ "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវមាន "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវតែផ្គូផ្គងនឹងទម្រង់ដែលបានកំណត់ ${_issue.pattern}`;
            return `មិនត្រឹមត្រូវ៖ ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `លេខមិនត្រឹមត្រូវ៖ ត្រូវតែជាពហុគុណនៃ ${issue.divisor}`;
          case "unrecognized_keys":
            return `រកឃើញសោមិនស្គាល់៖ ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `សោមិនត្រឹមត្រូវនៅក្នុង ${issue.origin}`;
          case "invalid_union":
            return `ទិន្នន័យមិនត្រឹមត្រូវ`;
          case "invalid_element":
            return `ទិន្នន័យមិនត្រឹមត្រូវនៅក្នុង ${issue.origin}`;
          default:
            return `ទិន្នន័យមិនត្រឹមត្រូវ`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(km$1, km$1.exports);
  return km$1.exports;
}
var kh = kh$1.exports;
var hasRequiredKh;
function requireKh() {
  if (hasRequiredKh) return kh$1.exports;
  hasRequiredKh = 1;
  (function(module2, exports2) {
    var __importDefault = kh && kh.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const km_js_1 = __importDefault(/* @__PURE__ */ requireKm());
    function default_1() {
      return (0, km_js_1.default)();
    }
    module2.exports = exports2.default;
  })(kh$1, kh$1.exports);
  return kh$1.exports;
}
var kn$1 = { exports: {} };
var kn = kn$1.exports;
var hasRequiredKn;
function requireKn() {
  if (hasRequiredKn) return kn$1.exports;
  hasRequiredKn = 1;
  (function(module2, exports2) {
    var __createBinding = kn && kn.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = kn && kn.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = kn && kn.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "ಅಕ್ಷರಗಳು", verb: "ಹೊಂದಲು" },
        file: { unit: "ಬೈಟ್‌ಗಳು", verb: "ಹೊಂದಲು" },
        array: { unit: "ವಸ್ತುಗಳು", verb: "ಹೊಂದಲು" },
        set: { unit: "ವಸ್ತುಗಳು", verb: "ಹೊಂದಲು" },
        map: { unit: "entries", verb: "ಹೊಂದಲು" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "ಇನ್ಪುಟ್",
        email: "email ವಿಳಾಸ",
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
        datetime: "ISO ದಿನಾಂಕದ ಸಮಯ",
        date: "ISO ದಿನಾಂಕ",
        time: "ISO ಸಮಯ",
        duration: "ISO ಅವಧಿ",
        ipv4: "IPv4 ವಿಳಾಸ",
        ipv6: "IPv6 ವಿಳಾಸ",
        mac: "MAC ವಿಳಾಸ",
        cidrv4: "IPv4 ವ್ಯಾಪ್ತಿಯ",
        cidrv6: "IPv6 ವ್ಯಾಪ್ತಿಯ",
        base64: "base64-encodedಸ್ಟ್ರಿಂಗ್",
        base64url: "base64url-encodedಸ್ಟ್ರಿಂಗ್",
        json_string: "JSONಸ್ಟ್ರಿಂಗ್",
        e164: "E.164 ಸಂಖ್ಯೆ",
        credit_card: "ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್ ಸಂಖ್ಯೆ",
        currency_code: "ಕರೆನ್ಸಿ ಕೋಡ್",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "ಇನ್ಪುಟ್"
      };
      const TypeDictionary = {
        // Compatibility: "nan" -> "NaN" for display
        nan: "NaN"
        // All other type names omitted - they fall back to raw values via ?? operator
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            return `ಅಮಾನ್ಯ ಇನ್‌ಪುಟ್: ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ ${expected}, ಸ್ವೀಕರಿಸಿದನು ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `ಅಮಾನ್ಯ ಇನ್‌ಪುಟ್: ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ ${util2.stringifyPrimitive(issue.values[0])}`;
            return `ಅಮಾನ್ಯ ಆಯ್ಕೆ: ಇವುಗಳಲ್ಲಿ ಒಂದನ್ನು ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `ತುಂಬಾ ದೊಡ್ಡದು: ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ ${issue.origin ?? "value"} ಹೊಂದಲು ${adj}${issue.maximum.toString()} ${sizing.unit ?? "ಅಂಶಗಳು"}`;
            return `ತುಂಬಾ ದೊಡ್ಡದು: ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ ${issue.origin ?? "value"} ಎಂದು ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `ತುಂಬಾ ಚಿಕ್ಕದು: ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ ${issue.origin} ಹೊಂದಲು ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `ತುಂಬಾ ಚಿಕ್ಕದು: ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ ${issue.origin} ಎಂದು ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `ಅಮಾನ್ಯವಾದ ಸ್ಟ್ರಿಂಗ್: ಇದರೊಂದಿಗೆ ಪ್ರಾರಂಭಿಸಬೇಕು "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `ಅಮಾನ್ಯವಾದ ಸ್ಟ್ರಿಂಗ್: ಇದರೊಂದಿಗೆ ಕೊನೆಗೊಳ್ಳಬೇಕು "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `ಅಮಾನ್ಯ ಸ್ಟ್ರಿಂಗ್: ಒಳಗೊಂಡಿರಬೇಕು "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `ಅಮಾನ್ಯವಾದ ಸ್ಟ್ರಿಂಗ್: ಮಾದರಿಗೆ ಹೊಂದಿಕೆಯಾಗಬೇಕು ${_issue.pattern}`;
            return `ಅಮಾನ್ಯ ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `ಅಮಾನ್ಯ ಸಂಖ್ಯೆ: ಬಹುಸಂಖ್ಯೆಯಾಗಿರಬೇಕು ${issue.divisor}`;
          case "unrecognized_keys":
            return `ಗುರುತಿಸಲಾಗದ ಕೀ ${issue.keys.length > 1 ? "s" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `ಅಮಾನ್ಯವಾದ ಕೀ ಇನ್ ${issue.origin}`;
          case "invalid_union":
            if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
              const opts = issue.options.map((o) => `'${o}'`).join(" | ");
              return `ಅಮಾನ್ಯ ತಾರತಮ್ಯ ಮೌಲ್ಯ. ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ ${opts}`;
            }
            return "ಅಮಾನ್ಯ ಇನ್‌ಪುಟ್";
          case "invalid_element":
            return `ರಲ್ಲಿ ಅಮಾನ್ಯ ಮೌಲ್ಯ ${issue.origin}`;
          default:
            return `ಅಮಾನ್ಯ ಇನ್‌ಪುಟ್`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(kn$1, kn$1.exports);
  return kn$1.exports;
}
var ko$1 = { exports: {} };
var ko = ko$1.exports;
var hasRequiredKo;
function requireKo() {
  if (hasRequiredKo) return ko$1.exports;
  hasRequiredKo = 1;
  (function(module2, exports2) {
    var __createBinding = ko && ko.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ko && ko.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ko && ko.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "문자", verb: "to have" },
        file: { unit: "바이트", verb: "to have" },
        array: { unit: "개", verb: "to have" },
        set: { unit: "개", verb: "to have" },
        map: { unit: "개", verb: "to have" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "입력",
        email: "이메일 주소",
        url: "URL",
        emoji: "이모지",
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
        datetime: "ISO 날짜시간",
        date: "ISO 날짜",
        time: "ISO 시간",
        duration: "ISO 기간",
        ipv4: "IPv4 주소",
        ipv6: "IPv6 주소",
        mac: "MAC 주소",
        cidrv4: "IPv4 범위",
        cidrv6: "IPv6 범위",
        base64: "base64 인코딩 문자열",
        base64url: "base64url 인코딩 문자열",
        json_string: "JSON 문자열",
        e164: "E.164 번호",
        credit_card: "신용카드 번호",
        currency_code: "통화 코드",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "입력"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `잘못된 입력: 예상 타입은 instanceof ${issue.expected}, 받은 타입은 ${received}입니다`;
            }
            return `잘못된 입력: 예상 타입은 ${expected}, 받은 타입은 ${received}입니다`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `잘못된 입력: 값은 ${util2.stringifyPrimitive(issue.values[0])} 이어야 합니다`;
            return `잘못된 옵션: ${util2.joinValues(issue.values, "또는 ")} 중 하나여야 합니다`;
          case "too_big": {
            const adj = issue.inclusive ? "이하" : "미만";
            const suffix = adj === "미만" ? "이어야 합니다" : "여야 합니다";
            const sizing = getSizing(issue.origin);
            const unit = sizing?.unit ?? "요소";
            if (sizing)
              return `${issue.origin ?? "값"}이 너무 큽니다: ${issue.maximum.toString()}${unit} ${adj}${suffix}`;
            return `${issue.origin ?? "값"}이 너무 큽니다: ${issue.maximum.toString()} ${adj}${suffix}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? "이상" : "초과";
            const suffix = adj === "이상" ? "이어야 합니다" : "여야 합니다";
            const sizing = getSizing(issue.origin);
            const unit = sizing?.unit ?? "요소";
            if (sizing) {
              return `${issue.origin ?? "값"}이 너무 작습니다: ${issue.minimum.toString()}${unit} ${adj}${suffix}`;
            }
            return `${issue.origin ?? "값"}이 너무 작습니다: ${issue.minimum.toString()} ${adj}${suffix}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `잘못된 문자열: "${_issue.prefix}"(으)로 시작해야 합니다`;
            }
            if (_issue.format === "ends_with")
              return `잘못된 문자열: "${_issue.suffix}"(으)로 끝나야 합니다`;
            if (_issue.format === "includes")
              return `잘못된 문자열: "${_issue.includes}"을(를) 포함해야 합니다`;
            if (_issue.format === "regex")
              return `잘못된 문자열: 정규식 ${_issue.pattern} 패턴과 일치해야 합니다`;
            return `잘못된 ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `잘못된 숫자: ${issue.divisor}의 배수여야 합니다`;
          case "unrecognized_keys":
            return `인식할 수 없는 키: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `잘못된 키: ${issue.origin}`;
          case "invalid_union":
            return `잘못된 입력`;
          case "invalid_element":
            return `잘못된 값: ${issue.origin}`;
          default:
            return `잘못된 입력`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ko$1, ko$1.exports);
  return ko$1.exports;
}
var lt$1 = { exports: {} };
var lt = lt$1.exports;
var hasRequiredLt;
function requireLt() {
  if (hasRequiredLt) return lt$1.exports;
  hasRequiredLt = 1;
  (function(module2, exports2) {
    var __createBinding = lt && lt.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = lt && lt.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = lt && lt.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const capitalizeFirstCharacter = (text) => {
      return text.charAt(0).toUpperCase() + text.slice(1);
    };
    function getUnitTypeFromNumber(number) {
      const abs = Math.abs(number);
      const last = abs % 10;
      const last2 = abs % 100;
      if (last2 >= 11 && last2 <= 19 || last === 0)
        return "many";
      if (last === 1)
        return "one";
      return "few";
    }
    const error = () => {
      const Sizable = {
        string: {
          unit: {
            one: "simbolis",
            few: "simboliai",
            many: "simbolių"
          },
          verb: {
            smaller: {
              inclusive: "turi būti ne ilgesnė kaip",
              notInclusive: "turi būti trumpesnė kaip"
            },
            bigger: {
              inclusive: "turi būti ne trumpesnė kaip",
              notInclusive: "turi būti ilgesnė kaip"
            }
          }
        },
        file: {
          unit: {
            one: "baitas",
            few: "baitai",
            many: "baitų"
          },
          verb: {
            smaller: {
              inclusive: "turi būti ne didesnis kaip",
              notInclusive: "turi būti mažesnis kaip"
            },
            bigger: {
              inclusive: "turi būti ne mažesnis kaip",
              notInclusive: "turi būti didesnis kaip"
            }
          }
        },
        array: {
          unit: {
            one: "elementą",
            few: "elementus",
            many: "elementų"
          },
          verb: {
            smaller: {
              inclusive: "turi turėti ne daugiau kaip",
              notInclusive: "turi turėti mažiau kaip"
            },
            bigger: {
              inclusive: "turi turėti ne mažiau kaip",
              notInclusive: "turi turėti daugiau kaip"
            }
          }
        },
        set: {
          unit: {
            one: "elementą",
            few: "elementus",
            many: "elementų"
          },
          verb: {
            smaller: {
              inclusive: "turi turėti ne daugiau kaip",
              notInclusive: "turi turėti mažiau kaip"
            },
            bigger: {
              inclusive: "turi turėti ne mažiau kaip",
              notInclusive: "turi turėti daugiau kaip"
            }
          }
        }
      };
      function getSizing(origin2, unitType, inclusive, targetShouldBe) {
        const result = Sizable[origin2] ?? null;
        if (result === null)
          return result;
        return {
          unit: result.unit[unitType],
          verb: result.verb[targetShouldBe][inclusive ? "inclusive" : "notInclusive"]
        };
      }
      const FormatDictionary = {
        regex: "įvestis",
        email: "el. pašto adresas",
        url: "URL",
        emoji: "jaustukas",
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
        datetime: "ISO data ir laikas",
        date: "ISO data",
        time: "ISO laikas",
        duration: "ISO trukmė",
        ipv4: "IPv4 adresas",
        ipv6: "IPv6 adresas",
        mac: "MAC adresas",
        cidrv4: "IPv4 tinklo prefiksas (CIDR)",
        cidrv6: "IPv6 tinklo prefiksas (CIDR)",
        base64: "base64 užkoduota eilutė",
        base64url: "base64url užkoduota eilutė",
        json_string: "JSON eilutė",
        e164: "E.164 numeris",
        credit_card: "kredito kortelės numeris",
        currency_code: "valiutos kodas",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "įvestis"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "skaičius",
        bigint: "sveikasis skaičius",
        string: "eilutė",
        boolean: "loginė reikšmė",
        undefined: "neapibrėžta reikšmė",
        function: "funkcija",
        symbol: "simbolis",
        array: "masyvas",
        object: "objektas",
        null: "nulinė reikšmė"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Gautas tipas ${received}, o tikėtasi - instanceof ${issue.expected}`;
            }
            return `Gautas tipas ${received}, o tikėtasi - ${expected}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Privalo būti ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Privalo būti vienas iš ${util2.joinValues(issue.values, "|")} pasirinkimų`;
          case "too_big": {
            const origin2 = TypeDictionary[issue.origin] ?? issue.origin;
            const sizing = getSizing(issue.origin, getUnitTypeFromNumber(Number(issue.maximum)), issue.inclusive ?? false, "smaller");
            if (sizing?.verb)
              return `${capitalizeFirstCharacter(origin2 ?? issue.origin ?? "reikšmė")} ${sizing.verb} ${issue.maximum.toString()} ${sizing.unit ?? "elementų"}`;
            const adj = issue.inclusive ? "ne didesnis kaip" : "mažesnis kaip";
            return `${capitalizeFirstCharacter(origin2 ?? issue.origin ?? "reikšmė")} turi būti ${adj} ${issue.maximum.toString()} ${sizing?.unit}`;
          }
          case "too_small": {
            const origin2 = TypeDictionary[issue.origin] ?? issue.origin;
            const sizing = getSizing(issue.origin, getUnitTypeFromNumber(Number(issue.minimum)), issue.inclusive ?? false, "bigger");
            if (sizing?.verb)
              return `${capitalizeFirstCharacter(origin2 ?? issue.origin ?? "reikšmė")} ${sizing.verb} ${issue.minimum.toString()} ${sizing.unit ?? "elementų"}`;
            const adj = issue.inclusive ? "ne mažesnis kaip" : "didesnis kaip";
            return `${capitalizeFirstCharacter(origin2 ?? issue.origin ?? "reikšmė")} turi būti ${adj} ${issue.minimum.toString()} ${sizing?.unit}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Eilutė privalo prasidėti "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Eilutė privalo pasibaigti "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Eilutė privalo įtraukti "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Eilutė privalo atitikti ${_issue.pattern}`;
            return `Neteisingas ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Skaičius privalo būti ${issue.divisor} kartotinis.`;
          case "unrecognized_keys":
            return `Neatpažint${issue.keys.length > 1 ? "i" : "as"} rakt${issue.keys.length > 1 ? "ai" : "as"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return "Rastas klaidingas raktas";
          case "invalid_union":
            return "Klaidinga įvestis";
          case "invalid_element": {
            const origin2 = TypeDictionary[issue.origin] ?? issue.origin;
            return `${capitalizeFirstCharacter(origin2 ?? issue.origin ?? "reikšmė")} turi klaidingą įvestį`;
          }
          default:
            return "Klaidinga įvestis";
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(lt$1, lt$1.exports);
  return lt$1.exports;
}
var mk$1 = { exports: {} };
var mk = mk$1.exports;
var hasRequiredMk;
function requireMk() {
  if (hasRequiredMk) return mk$1.exports;
  hasRequiredMk = 1;
  (function(module2, exports2) {
    var __createBinding = mk && mk.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = mk && mk.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = mk && mk.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "знаци", verb: "да имаат" },
        file: { unit: "бајти", verb: "да имаат" },
        array: { unit: "ставки", verb: "да имаат" },
        set: { unit: "ставки", verb: "да имаат" },
        map: { unit: "ставки", verb: "да имаат" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "внес",
        email: "адреса на е-пошта",
        url: "URL",
        emoji: "емоџи",
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
        datetime: "ISO датум и време",
        date: "ISO датум",
        time: "ISO време",
        duration: "ISO времетраење",
        ipv4: "IPv4 адреса",
        ipv6: "IPv6 адреса",
        mac: "MAC адреса",
        cidrv4: "IPv4 опсег",
        cidrv6: "IPv6 опсег",
        base64: "base64-енкодирана низа",
        base64url: "base64url-енкодирана низа",
        json_string: "JSON низа",
        e164: "E.164 број",
        credit_card: "број на кредитна картичка",
        currency_code: "код на валута",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "внес"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "број",
        array: "низа"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Грешен внес: се очекува instanceof ${issue.expected}, примено ${received}`;
            }
            return `Грешен внес: се очекува ${expected}, примено ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Invalid input: expected ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Грешана опција: се очекува една ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Премногу голем: се очекува ${issue.origin ?? "вредноста"} да има ${adj}${issue.maximum.toString()} ${sizing.unit ?? "елементи"}`;
            return `Премногу голем: се очекува ${issue.origin ?? "вредноста"} да биде ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Премногу мал: се очекува ${issue.origin} да има ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Премногу мал: се очекува ${issue.origin} да биде ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Неважечка низа: мора да започнува со "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Неважечка низа: мора да завршува со "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Неважечка низа: мора да вклучува "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Неважечка низа: мора да одгоара на патернот ${_issue.pattern}`;
            return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Грешен број: мора да биде делив со ${issue.divisor}`;
          case "unrecognized_keys":
            return `${issue.keys.length > 1 ? "Непрепознаени клучеви" : "Непрепознаен клуч"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Грешен клуч во ${issue.origin}`;
          case "invalid_union":
            return "Грешен внес";
          case "invalid_element":
            return `Грешна вредност во ${issue.origin}`;
          default:
            return `Грешен внес`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(mk$1, mk$1.exports);
  return mk$1.exports;
}
var ms$1 = { exports: {} };
var ms = ms$1.exports;
var hasRequiredMs;
function requireMs() {
  if (hasRequiredMs) return ms$1.exports;
  hasRequiredMs = 1;
  (function(module2, exports2) {
    var __createBinding = ms && ms.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ms && ms.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ms && ms.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "aksara", verb: "mempunyai" },
        file: { unit: "bait", verb: "mempunyai" },
        array: { unit: "elemen", verb: "mempunyai" },
        set: { unit: "elemen", verb: "mempunyai" },
        map: { unit: "elemen", verb: "mempunyai" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "input",
        email: "alamat e-mel",
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
        datetime: "tarikh masa ISO",
        date: "tarikh ISO",
        time: "masa ISO",
        duration: "tempoh ISO",
        ipv4: "alamat IPv4",
        ipv6: "alamat IPv6",
        mac: "alamat MAC",
        cidrv4: "julat IPv4",
        cidrv6: "julat IPv6",
        base64: "string dikodkan base64",
        base64url: "string dikodkan base64url",
        json_string: "string JSON",
        e164: "nombor E.164",
        credit_card: "nombor kad kredit",
        currency_code: "kod mata wang",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "input"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "nombor"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Input tidak sah: dijangka instanceof ${issue.expected}, diterima ${received}`;
            }
            return `Input tidak sah: dijangka ${expected}, diterima ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Input tidak sah: dijangka ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Pilihan tidak sah: dijangka salah satu daripada ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Terlalu besar: dijangka ${issue.origin ?? "nilai"} ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elemen"}`;
            return `Terlalu besar: dijangka ${issue.origin ?? "nilai"} adalah ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Terlalu kecil: dijangka ${issue.origin} ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Terlalu kecil: dijangka ${issue.origin} adalah ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `String tidak sah: mesti bermula dengan "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `String tidak sah: mesti berakhir dengan "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `String tidak sah: mesti mengandungi "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `String tidak sah: mesti sepadan dengan corak ${_issue.pattern}`;
            return `${FormatDictionary[_issue.format] ?? issue.format} tidak sah`;
          }
          case "not_multiple_of":
            return `Nombor tidak sah: perlu gandaan ${issue.divisor}`;
          case "unrecognized_keys":
            return `Kunci tidak dikenali: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Kunci tidak sah dalam ${issue.origin}`;
          case "invalid_union":
            return "Input tidak sah";
          case "invalid_element":
            return `Nilai tidak sah dalam ${issue.origin}`;
          default:
            return `Input tidak sah`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ms$1, ms$1.exports);
  return ms$1.exports;
}
var ne$1 = { exports: {} };
var ne = ne$1.exports;
var hasRequiredNe;
function requireNe() {
  if (hasRequiredNe) return ne$1.exports;
  hasRequiredNe = 1;
  (function(module2, exports2) {
    var __createBinding = ne && ne.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ne && ne.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ne && ne.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "अक्षर", verb: "हुनुपर्छ" },
        file: { unit: "बाइट", verb: "हुनुपर्छ" },
        array: { unit: "तत्व", verb: "हुनुपर्छ" },
        set: { unit: "तत्व", verb: "हुनुपर्छ" },
        map: { unit: "प्रविष्टि", verb: "हुनुपर्छ" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "इनपुट",
        email: "इमेल ठेगाना",
        url: "URL",
        emoji: "इमोजी",
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
        datetime: "ISO मिति र समय",
        date: "ISO मिति",
        time: "ISO समय",
        duration: "ISO अवधि",
        ipv4: "IPv4 ठेगाना",
        ipv6: "IPv6 ठेगाना",
        mac: "MAC ठेगाना",
        cidrv4: "IPv4 दायरा",
        cidrv6: "IPv6 दायरा",
        base64: "base64-इन्कोड गरिएको स्ट्रिङ",
        base64url: "base64url-इन्कोड गरिएको स्ट्रिङ",
        json_string: "JSON स्ट्रिङ",
        e164: "E.164 नम्बर",
        credit_card: "क्रेडिट कार्ड नम्बर",
        currency_code: "मुद्रा कोड",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "इनपुट"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            return `अमान्य इनपुट: अपेक्षित ${expected}, प्राप्त ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `अमान्य इनपुट: अपेक्षित ${util2.stringifyPrimitive(issue.values[0])}`;
            return `अमान्य विकल्प: अपेक्षित मानहरू मध्ये एक ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `धेरै ठूलो: ${issue.origin ?? "मान"} मा ${adj}${issue.maximum.toString()} ${sizing.unit} ${sizing.verb}`;
            return `धेरै ठूलो: ${issue.origin ?? "मान"} ${adj}${issue.maximum.toString()} हुनुपर्छ`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `धेरै सानो: ${issue.origin} मा ${adj}${issue.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
            return `धेरै सानो: ${issue.origin} ${adj}${issue.minimum.toString()} हुनुपर्छ`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `अमान्य स्ट्रिङ: "${_issue.prefix}" बाट सुरु हुनुपर्छ`;
            if (_issue.format === "ends_with")
              return `अमान्य स्ट्रिङ: "${_issue.suffix}" मा समाप्त हुनुपर्छ`;
            if (_issue.format === "includes")
              return `अमान्य स्ट्रिङ: "${_issue.includes}" समावेश हुनुपर्छ`;
            if (_issue.format === "regex")
              return `अमान्य स्ट्रिङ: ढाँचा ${_issue.pattern} सँग मेल खानुपर्छ`;
            return `अमान्य ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `अमान्य संख्या: ${issue.divisor} को गुणज हुनुपर्छ`;
          case "unrecognized_keys":
            return `अपरिचित कुञ्जी${issue.keys.length > 1 ? "हरू" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `अमान्य कुञ्जी: ${issue.origin} मा`;
          case "invalid_union":
            if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
              const opts = issue.options.map((o) => `'${o}'`).join(" | ");
              return `अमान्य डिस्क्रिमिनेटर मान: अपेक्षित ${opts}`;
            }
            return "अमान्य इनपुट";
          case "invalid_element":
            return `अमान्य मान: ${issue.origin} मा`;
          default:
            return `अमान्य इनपुट`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ne$1, ne$1.exports);
  return ne$1.exports;
}
var nl$1 = { exports: {} };
var nl = nl$1.exports;
var hasRequiredNl;
function requireNl() {
  if (hasRequiredNl) return nl$1.exports;
  hasRequiredNl = 1;
  (function(module2, exports2) {
    var __createBinding = nl && nl.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = nl && nl.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = nl && nl.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "tekens", verb: "heeft" },
        file: { unit: "bytes", verb: "heeft" },
        array: { unit: "elementen", verb: "heeft" },
        set: { unit: "elementen", verb: "heeft" },
        map: { unit: "elementen", verb: "heeft" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "invoer",
        email: "emailadres",
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
        datetime: "ISO datum en tijd",
        date: "ISO datum",
        time: "ISO tijd",
        duration: "ISO duur",
        ipv4: "IPv4-adres",
        ipv6: "IPv6-adres",
        mac: "MAC-adres",
        cidrv4: "IPv4-bereik",
        cidrv6: "IPv6-bereik",
        base64: "base64-gecodeerde tekst",
        base64url: "base64 URL-gecodeerde tekst",
        json_string: "JSON string",
        e164: "E.164-nummer",
        credit_card: "creditcardnummer",
        currency_code: "valutacode",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "invoer"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "getal"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Ongeldige invoer: verwacht instanceof ${issue.expected}, ontving ${received}`;
            }
            return `Ongeldige invoer: verwacht ${expected}, ontving ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Ongeldige invoer: verwacht ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Ongeldige optie: verwacht één van ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            const longName = issue.origin === "date" ? "laat" : issue.origin === "string" ? "lang" : "groot";
            if (sizing)
              return `Te ${longName}: verwacht dat ${issue.origin ?? "waarde"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementen"} ${sizing.verb}`;
            return `Te ${longName}: verwacht dat ${issue.origin ?? "waarde"} ${adj}${issue.maximum.toString()} is`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            const shortName = issue.origin === "date" ? "vroeg" : issue.origin === "string" ? "kort" : "klein";
            if (sizing) {
              return `Te ${shortName}: verwacht dat ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
            }
            return `Te ${shortName}: verwacht dat ${issue.origin} ${adj}${issue.minimum.toString()} is`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Ongeldige tekst: moet met "${_issue.prefix}" beginnen`;
            }
            if (_issue.format === "ends_with")
              return `Ongeldige tekst: moet op "${_issue.suffix}" eindigen`;
            if (_issue.format === "includes")
              return `Ongeldige tekst: moet "${_issue.includes}" bevatten`;
            if (_issue.format === "regex")
              return `Ongeldige tekst: moet overeenkomen met patroon ${_issue.pattern}`;
            return `Ongeldig: ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Ongeldig getal: moet een veelvoud van ${issue.divisor} zijn`;
          case "unrecognized_keys":
            return `Onbekende key${issue.keys.length > 1 ? "s" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Ongeldige key in ${issue.origin}`;
          case "invalid_union":
            return "Ongeldige invoer";
          case "invalid_element":
            return `Ongeldige waarde in ${issue.origin}`;
          default:
            return `Ongeldige invoer`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(nl$1, nl$1.exports);
  return nl$1.exports;
}
var nn$1 = { exports: {} };
var nn = nn$1.exports;
var hasRequiredNn;
function requireNn() {
  if (hasRequiredNn) return nn$1.exports;
  hasRequiredNn = 1;
  (function(module2, exports2) {
    var __createBinding = nn && nn.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = nn && nn.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = nn && nn.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "teikn", verb: "å ha" },
        file: { unit: "bytes", verb: "å ha" },
        array: { unit: "element", verb: "å innehalde" },
        set: { unit: "element", verb: "å innehalde" },
        map: { unit: "element", verb: "å innehalde" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "input",
        email: "e-postadresse",
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
        datetime: "ISO dato- og klokkeslett",
        date: "ISO-dato",
        time: "ISO-klokkeslett",
        duration: "ISO-varigheit",
        ipv4: "IPv4-adresse",
        ipv6: "IPv6-adresse",
        mac: "MAC-adresse",
        cidrv4: "IPv4-spekter",
        cidrv6: "IPv6-spekter",
        base64: "base64-enkoda streng",
        base64url: "base64url-enkoda streng",
        json_string: "JSON-streng",
        e164: "E.164-nummer",
        credit_card: "kredittkortnummer",
        currency_code: "valutakode",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "input"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "tal",
        array: "liste"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Ugyldig input: forventa instanceof ${issue.expected}, fekk ${received}`;
            }
            return `Ugyldig input: forventa ${expected}, fekk ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Ugyldig verdi: forventa ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Ugyldig val: forventa eitt av ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `For stor(t): forventa ${issue.origin ?? "value"} til å ha ${adj}${issue.maximum.toString()} ${sizing.unit ?? "element"}`;
            return `For stor(t): forventa ${issue.origin ?? "value"} til å ha ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `For lite(n): forventa ${issue.origin} til å ha ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `For lite(n): forventa ${issue.origin} til å ha ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Ugyldig streng: må starte med "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Ugyldig streng: må slutte med "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Ugyldig streng: må innehalde "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Ugyldig streng: må matche mønsteret ${_issue.pattern}`;
            return `Ugyldig ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Ugyldig tal: må vere eit multiplum av ${issue.divisor}`;
          case "unrecognized_keys":
            return `${issue.keys.length > 1 ? "Ukjende nøklar" : "Ukjend nøkkel"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Ugyldig nøkkel i ${issue.origin}`;
          case "invalid_union":
            return "Ugyldig input";
          case "invalid_element":
            return `Ugyldig verdi i ${issue.origin}`;
          default:
            return `Ugyldig input`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(nn$1, nn$1.exports);
  return nn$1.exports;
}
var no$1 = { exports: {} };
var no = no$1.exports;
var hasRequiredNo;
function requireNo() {
  if (hasRequiredNo) return no$1.exports;
  hasRequiredNo = 1;
  (function(module2, exports2) {
    var __createBinding = no && no.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = no && no.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = no && no.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "tegn", verb: "å ha" },
        file: { unit: "bytes", verb: "å ha" },
        array: { unit: "elementer", verb: "å inneholde" },
        set: { unit: "elementer", verb: "å inneholde" },
        map: { unit: "elementer", verb: "å inneholde" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "input",
        email: "e-postadresse",
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
        datetime: "ISO dato- og klokkeslett",
        date: "ISO-dato",
        time: "ISO-klokkeslett",
        duration: "ISO-varighet",
        ipv4: "IPv4-adresse",
        ipv6: "IPv6-adresse",
        mac: "MAC-adresse",
        cidrv4: "IPv4-spekter",
        cidrv6: "IPv6-spekter",
        base64: "base64-enkodet streng",
        base64url: "base64url-enkodet streng",
        json_string: "JSON-streng",
        e164: "E.164-nummer",
        credit_card: "kredittkortnummer",
        currency_code: "valutakode",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "input"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "tall",
        array: "liste"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Ugyldig input: forventet instanceof ${issue.expected}, fikk ${received}`;
            }
            return `Ugyldig input: forventet ${expected}, fikk ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Ugyldig verdi: forventet ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Ugyldig valg: forventet en av ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `For stor(t): forventet ${issue.origin ?? "value"} til å ha ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementer"}`;
            return `For stor(t): forventet ${issue.origin ?? "value"} til å ha ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `For lite(n): forventet ${issue.origin} til å ha ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `For lite(n): forventet ${issue.origin} til å ha ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Ugyldig streng: må starte med "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Ugyldig streng: må ende med "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Ugyldig streng: må inneholde "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Ugyldig streng: må matche mønsteret ${_issue.pattern}`;
            return `Ugyldig ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Ugyldig tall: må være et multiplum av ${issue.divisor}`;
          case "unrecognized_keys":
            return `${issue.keys.length > 1 ? "Ukjente nøkler" : "Ukjent nøkkel"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Ugyldig nøkkel i ${issue.origin}`;
          case "invalid_union":
            return "Ugyldig input";
          case "invalid_element":
            return `Ugyldig verdi i ${issue.origin}`;
          default:
            return `Ugyldig input`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(no$1, no$1.exports);
  return no$1.exports;
}
var ota$1 = { exports: {} };
var ota = ota$1.exports;
var hasRequiredOta;
function requireOta() {
  if (hasRequiredOta) return ota$1.exports;
  hasRequiredOta = 1;
  (function(module2, exports2) {
    var __createBinding = ota && ota.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ota && ota.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ota && ota.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "harf", verb: "olmalıdır" },
        file: { unit: "bayt", verb: "olmalıdır" },
        array: { unit: "unsur", verb: "olmalıdır" },
        set: { unit: "unsur", verb: "olmalıdır" },
        map: { unit: "unsur", verb: "olmalıdır" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "giren",
        email: "epostagâh",
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
        datetime: "ISO hengâmı",
        date: "ISO tarihi",
        time: "ISO zamanı",
        duration: "ISO müddeti",
        ipv4: "IPv4 nişânı",
        ipv6: "IPv6 nişânı",
        mac: "MAC nişânı",
        cidrv4: "IPv4 menzili",
        cidrv6: "IPv6 menzili",
        base64: "base64-şifreli metin",
        base64url: "base64url-şifreli metin",
        json_string: "JSON metin",
        e164: "E.164 sayısı",
        credit_card: "i'tibâr kartı numarası",
        currency_code: "para birimi kodu",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "giren"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "numara",
        array: "saf",
        null: "gayb"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Fâsit giren: umulan instanceof ${issue.expected}, alınan ${received}`;
            }
            return `Fâsit giren: umulan ${expected}, alınan ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Fâsit giren: umulan ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Fâsit tercih: mûteberler ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Fazla büyük: ${issue.origin ?? "value"}, ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"} sahip olmalıydı.`;
            return `Fazla büyük: ${issue.origin ?? "value"}, ${adj}${issue.maximum.toString()} olmalıydı.`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Fazla küçük: ${issue.origin}, ${adj}${issue.minimum.toString()} ${sizing.unit} sahip olmalıydı.`;
            }
            return `Fazla küçük: ${issue.origin}, ${adj}${issue.minimum.toString()} olmalıydı.`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Fâsit metin: "${_issue.prefix}" ile başlamalı.`;
            if (_issue.format === "ends_with")
              return `Fâsit metin: "${_issue.suffix}" ile bitmeli.`;
            if (_issue.format === "includes")
              return `Fâsit metin: "${_issue.includes}" ihtivâ etmeli.`;
            if (_issue.format === "regex")
              return `Fâsit metin: ${_issue.pattern} nakşına uymalı.`;
            return `Fâsit ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Fâsit sayı: ${issue.divisor} katı olmalıydı.`;
          case "unrecognized_keys":
            return `Tanınmayan anahtar ${issue.keys.length > 1 ? "s" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `${issue.origin} için tanınmayan anahtar var.`;
          case "invalid_union":
            return "Giren tanınamadı.";
          case "invalid_element":
            return `${issue.origin} için tanınmayan kıymet var.`;
          default:
            return `Kıymet tanınamadı.`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ota$1, ota$1.exports);
  return ota$1.exports;
}
var ps$1 = { exports: {} };
var ps = ps$1.exports;
var hasRequiredPs;
function requirePs() {
  if (hasRequiredPs) return ps$1.exports;
  hasRequiredPs = 1;
  (function(module2, exports2) {
    var __createBinding = ps && ps.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ps && ps.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ps && ps.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "توکي", verb: "ولري" },
        file: { unit: "بایټس", verb: "ولري" },
        array: { unit: "توکي", verb: "ولري" },
        set: { unit: "توکي", verb: "ولري" },
        map: { unit: "توکي", verb: "ولري" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "ورودي",
        email: "بریښنالیک",
        url: "یو آر ال",
        emoji: "ایموجي",
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
        datetime: "نیټه او وخت",
        date: "نېټه",
        time: "وخت",
        duration: "موده",
        ipv4: "د IPv4 پته",
        ipv6: "د IPv6 پته",
        mac: "د MAC پته",
        cidrv4: "د IPv4 ساحه",
        cidrv6: "د IPv6 ساحه",
        base64: "base64-encoded متن",
        base64url: "base64url-encoded متن",
        json_string: "JSON متن",
        e164: "د E.164 شمېره",
        credit_card: "د کریډیټ کارت شمیره",
        currency_code: "د اسعارو کوډ",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "ورودي"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "عدد",
        array: "ارې"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `ناسم ورودي: باید instanceof ${issue.expected} وای, مګر ${received} ترلاسه شو`;
            }
            return `ناسم ورودي: باید ${expected} وای, مګر ${received} ترلاسه شو`;
          }
          case "invalid_value":
            if (issue.values.length === 1) {
              return `ناسم ورودي: باید ${util2.stringifyPrimitive(issue.values[0])} وای`;
            }
            return `ناسم انتخاب: باید یو له ${util2.joinValues(issue.values, "|")} څخه وای`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `ډیر لوی: ${issue.origin ?? "ارزښت"} باید ${adj}${issue.maximum.toString()} ${sizing.unit ?? "عنصرونه"} ولري`;
            }
            return `ډیر لوی: ${issue.origin ?? "ارزښت"} باید ${adj}${issue.maximum.toString()} وي`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `ډیر کوچنی: ${issue.origin} باید ${adj}${issue.minimum.toString()} ${sizing.unit} ولري`;
            }
            return `ډیر کوچنی: ${issue.origin} باید ${adj}${issue.minimum.toString()} وي`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `ناسم متن: باید د "${_issue.prefix}" سره پیل شي`;
            }
            if (_issue.format === "ends_with") {
              return `ناسم متن: باید د "${_issue.suffix}" سره پای ته ورسيږي`;
            }
            if (_issue.format === "includes") {
              return `ناسم متن: باید "${_issue.includes}" ولري`;
            }
            if (_issue.format === "regex") {
              return `ناسم متن: باید د ${_issue.pattern} سره مطابقت ولري`;
            }
            return `${FormatDictionary[_issue.format] ?? issue.format} ناسم دی`;
          }
          case "not_multiple_of":
            return `ناسم عدد: باید د ${issue.divisor} مضرب وي`;
          case "unrecognized_keys":
            return `ناسم ${issue.keys.length > 1 ? "کلیډونه" : "کلیډ"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `ناسم کلیډ په ${issue.origin} کې`;
          case "invalid_union":
            return `ناسمه ورودي`;
          case "invalid_element":
            return `ناسم عنصر په ${issue.origin} کې`;
          default:
            return `ناسمه ورودي`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ps$1, ps$1.exports);
  return ps$1.exports;
}
var pl$1 = { exports: {} };
var pl = pl$1.exports;
var hasRequiredPl;
function requirePl() {
  if (hasRequiredPl) return pl$1.exports;
  hasRequiredPl = 1;
  (function(module2, exports2) {
    var __createBinding = pl && pl.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = pl && pl.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = pl && pl.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "znaków", verb: "mieć" },
        file: { unit: "bajtów", verb: "mieć" },
        array: { unit: "elementów", verb: "mieć" },
        set: { unit: "elementów", verb: "mieć" },
        map: { unit: "elementów", verb: "mieć" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "wyrażenie",
        email: "adres email",
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
        datetime: "data i godzina w formacie ISO",
        date: "data w formacie ISO",
        time: "godzina w formacie ISO",
        duration: "czas trwania ISO",
        ipv4: "adres IPv4",
        ipv6: "adres IPv6",
        mac: "adres MAC",
        cidrv4: "zakres IPv4",
        cidrv6: "zakres IPv6",
        base64: "ciąg znaków zakodowany w formacie base64",
        base64url: "ciąg znaków zakodowany w formacie base64url",
        json_string: "ciąg znaków w formacie JSON",
        e164: "liczba E.164",
        credit_card: "numer karty kredytowej",
        currency_code: "kod waluty",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "wejście"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "liczba",
        array: "tablica"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Nieprawidłowe dane wejściowe: oczekiwano instanceof ${issue.expected}, otrzymano ${received}`;
            }
            return `Nieprawidłowe dane wejściowe: oczekiwano ${expected}, otrzymano ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Nieprawidłowe dane wejściowe: oczekiwano ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Nieprawidłowa opcja: oczekiwano jednej z wartości ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Za duża wartość: oczekiwano, że ${issue.origin ?? "wartość"} będzie mieć ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementów"}`;
            }
            return `Zbyt duż(y/a/e): oczekiwano, że ${issue.origin ?? "wartość"} będzie wynosić ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Za mała wartość: oczekiwano, że ${issue.origin ?? "wartość"} będzie mieć ${adj}${issue.minimum.toString()} ${sizing.unit ?? "elementów"}`;
            }
            return `Zbyt mał(y/a/e): oczekiwano, że ${issue.origin ?? "wartość"} będzie wynosić ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Nieprawidłowy ciąg znaków: musi zaczynać się od "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Nieprawidłowy ciąg znaków: musi kończyć się na "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Nieprawidłowy ciąg znaków: musi zawierać "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Nieprawidłowy ciąg znaków: musi odpowiadać wzorcowi ${_issue.pattern}`;
            return `Nieprawidłow(y/a/e) ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Nieprawidłowa liczba: musi być wielokrotnością ${issue.divisor}`;
          case "unrecognized_keys":
            return `Nierozpoznane klucze${issue.keys.length > 1 ? "s" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Nieprawidłowy klucz w ${issue.origin}`;
          case "invalid_union":
            return "Nieprawidłowe dane wejściowe";
          case "invalid_element":
            return `Nieprawidłowa wartość w ${issue.origin}`;
          default:
            return `Nieprawidłowe dane wejściowe`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(pl$1, pl$1.exports);
  return pl$1.exports;
}
var pt$1 = { exports: {} };
var pt = pt$1.exports;
var hasRequiredPt;
function requirePt() {
  if (hasRequiredPt) return pt$1.exports;
  hasRequiredPt = 1;
  (function(module2, exports2) {
    var __createBinding = pt && pt.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = pt && pt.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = pt && pt.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "caracteres" },
        file: { unit: "bytes" },
        array: { unit: "elementos" },
        set: { unit: "elementos" },
        map: { unit: "entradas" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "a entrada",
        email: "o endereço de e-mail",
        url: "o URL",
        emoji: "o emoji",
        uuid: "o UUID",
        uuidv4: "o UUIDv4",
        uuidv6: "o UUIDv6",
        nanoid: "o nanoid",
        guid: "o GUID",
        cuid: "o cuid",
        cuid2: "o cuid2",
        ulid: "o ULID",
        xid: "o XID",
        ksuid: "o KSUID",
        datetime: "a data e hora ISO",
        date: "a data ISO",
        time: "a hora ISO",
        duration: "a duração ISO",
        ipv4: "o endereço IPv4",
        ipv6: "o endereço IPv6",
        mac: "o endereço MAC",
        cidrv4: "o intervalo de endereços IPv4",
        cidrv6: "o intervalo de endereços IPv6",
        base64: "o texto codificado em base64",
        base64url: "o texto codificado em base64url",
        json_string: "o texto JSON",
        e164: "o número E.164",
        credit_card: "o número de cartão de crédito",
        currency_code: "o código de moeda",
        iban: "o IBAN",
        jwt: "o JWT",
        template_literal: "a entrada"
      };
      const Gender = {
        masculine: { definite: "o", indefinite: "um" },
        feminine: { definite: "a", indefinite: "uma" }
      };
      const TypeDictionary = {
        string: { name: "texto", articles: Gender.masculine },
        number: { name: "número", articles: Gender.masculine },
        int: { name: "número inteiro", articles: Gender.masculine },
        boolean: { name: "valor booleano", articles: Gender.masculine },
        bigint: { name: "número bigint", articles: Gender.masculine },
        symbol: { name: "símbolo", articles: Gender.masculine },
        undefined: { name: 'valor "undefined"', articles: Gender.masculine },
        null: { name: 'valor "nulo"', articles: Gender.masculine },
        never: { name: 'valor "never"', articles: Gender.masculine },
        void: { name: 'valor "void"', articles: Gender.masculine },
        date: { name: "data", articles: Gender.feminine },
        array: { name: "vetor", articles: Gender.masculine },
        object: { name: "objeto", articles: Gender.masculine },
        tuple: { name: "tuplo", articles: Gender.masculine },
        record: { name: "registo", articles: Gender.masculine },
        map: { name: "mapa", articles: Gender.masculine },
        set: { name: "conjunto", articles: Gender.masculine },
        file: { name: "ficheiro", articles: Gender.masculine },
        nonoptional: { name: "valor não opcional", articles: Gender.masculine },
        nan: { name: 'valor "NaN"', articles: Gender.masculine },
        // Compatibility: "nan" -> "NaN" for display
        function: { name: "função", articles: Gender.feminine }
      };
      function translateOriginWithArticle(type, articleType) {
        const translatedValue = TypeDictionary[type] ?? { name: `valor "${type}"`, articles: Gender.masculine };
        return `${translatedValue.articles[articleType]} ${translatedValue.name}`;
      }
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = translateOriginWithArticle(issue.expected, "indefinite");
            const receivedType = util2.parsedType(issue.input);
            const received = translateOriginWithArticle(receivedType, "indefinite");
            return `Entrada inválida: esperava ${expected}, recebeu ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Entrada inválida: esperava ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Opção inválida: esperava uma das seguintes opções: ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Demasiado grande: esperava que ${translateOriginWithArticle(issue.origin, "definite")} tivesse ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "elementos"}`;
            return `Demasiado grande: esperava que ${translateOriginWithArticle(issue.origin, "definite")} fosse ${adj} ${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Demasiado pequeno: esperava que ${translateOriginWithArticle(issue.origin, "definite")} tivesse ${adj} ${issue.minimum.toString()} ${sizing.unit ?? "elementos"}`;
            }
            return `Demasiado pequeno: esperava que ${translateOriginWithArticle(issue.origin, "definite")} fosse ${adj} ${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Texto inválido: deve começar por "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Texto inválido: deve terminar em "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Texto inválido: deve incluir "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Texto inválido: deve corresponder ao padrão ${_issue.pattern}`;
            return `Formato d${FormatDictionary[_issue.format] ?? issue.format} inválido`;
          }
          case "not_multiple_of":
            return `Número inválido: deve ser múltiplo de ${issue.divisor}`;
          case "unrecognized_keys": {
            const plural = issue.keys.length > 1 ? "s" : "";
            return `Chave${plural} inválida${plural}: ${util2.joinValues(issue.keys, ", ")}`;
          }
          case "invalid_key":
            return `Entrada inválida n${translateOriginWithArticle(issue.origin, "definite")}`;
          case "invalid_union":
            if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
              const opts = issue.options.map((o) => `'${o}'`).join(" | ");
              return `Valor de discriminação inválido. Esperava ${opts}`;
            }
            return "Entrada inválida";
          case "invalid_element":
            return `Entrada inválida n${translateOriginWithArticle(issue.origin, "definite")}`;
          default:
            return `Entrada inválida`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(pt$1, pt$1.exports);
  return pt$1.exports;
}
var ptBR$1 = { exports: {} };
var ptBR = ptBR$1.exports;
var hasRequiredPtBR;
function requirePtBR() {
  if (hasRequiredPtBR) return ptBR$1.exports;
  hasRequiredPtBR = 1;
  (function(module2, exports2) {
    var __createBinding = ptBR && ptBR.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ptBR && ptBR.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ptBR && ptBR.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "caracteres" },
        file: { unit: "bytes" },
        array: { unit: "elementos" },
        set: { unit: "elementos" },
        map: { unit: "entradas" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "a entrada",
        email: "o endereço de e-mail",
        url: "o URL",
        emoji: "o emoji",
        uuid: "o UUID",
        uuidv4: "o UUIDv4",
        uuidv6: "o UUIDv6",
        nanoid: "o nanoid",
        guid: "o GUID",
        cuid: "o cuid",
        cuid2: "o cuid2",
        ulid: "o ULID",
        xid: "o XID",
        ksuid: "o KSUID",
        datetime: "a data e hora ISO",
        date: "a data ISO",
        time: "a hora ISO",
        duration: "a duração ISO",
        ipv4: "o endereço IPv4",
        ipv6: "o endereço IPv6",
        mac: "o endereço MAC",
        cidrv4: "a faixa de endereços IPv4",
        cidrv6: "a faixa de endereços IPv6",
        base64: "o texto codificado em base64",
        base64url: "o texto codificado em base64url",
        json_string: "o texto JSON",
        e164: "o número E.164",
        credit_card: "o número de cartão de crédito",
        currency_code: "o código de moeda",
        iban: "o IBAN",
        jwt: "o JWT",
        template_literal: "a entrada"
      };
      const Gender = {
        masculine: { definite: "o", indefinite: "um" },
        feminine: { definite: "a", indefinite: "uma" }
      };
      const TypeDictionary = {
        string: { name: "texto", articles: Gender.masculine },
        number: { name: "número", articles: Gender.masculine },
        int: { name: "número inteiro", articles: Gender.masculine },
        boolean: { name: "valor booleano", articles: Gender.masculine },
        bigint: { name: "número bigint", articles: Gender.masculine },
        symbol: { name: "símbolo", articles: Gender.masculine },
        undefined: { name: 'valor "undefined"', articles: Gender.masculine },
        null: { name: 'valor "nulo"', articles: Gender.masculine },
        never: { name: 'valor "never"', articles: Gender.masculine },
        void: { name: 'valor "void"', articles: Gender.masculine },
        date: { name: "data", articles: Gender.feminine },
        array: { name: "vetor", articles: Gender.masculine },
        object: { name: "objeto", articles: Gender.masculine },
        tuple: { name: "tupla", articles: Gender.feminine },
        record: { name: "registro", articles: Gender.masculine },
        map: { name: "mapa", articles: Gender.masculine },
        set: { name: "conjunto", articles: Gender.masculine },
        file: { name: "arquivo", articles: Gender.masculine },
        nonoptional: { name: "valor não opcional", articles: Gender.masculine },
        nan: { name: 'valor "NaN"', articles: Gender.masculine },
        // Compatibility: "nan" -> "NaN" for display
        function: { name: "função", articles: Gender.feminine }
      };
      function translateOriginWithArticle(type, articleType) {
        const translatedValue = TypeDictionary[type] ?? { name: `valor "${type}"`, articles: Gender.masculine };
        return `${translatedValue.articles[articleType]} ${translatedValue.name}`;
      }
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = translateOriginWithArticle(issue.expected, "indefinite");
            const receivedType = util2.parsedType(issue.input);
            const received = translateOriginWithArticle(receivedType, "indefinite");
            return `Entrada inválida: esperava ${expected}, recebeu ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Entrada inválida: esperava ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Opção inválida: esperava uma das seguintes opções: ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Grande demais: esperava que ${translateOriginWithArticle(issue.origin, "definite")} tivesse ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "elementos"}`;
            return `Grande demais: esperava que ${translateOriginWithArticle(issue.origin, "definite")} fosse ${adj} ${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Pequeno demais: esperava que ${translateOriginWithArticle(issue.origin, "definite")} tivesse ${adj} ${issue.minimum.toString()} ${sizing.unit ?? "elementos"}`;
            }
            return `Pequeno demais: esperava que ${translateOriginWithArticle(issue.origin, "definite")} fosse ${adj} ${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Texto inválido: deve começar com "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Texto inválido: deve terminar com "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Texto inválido: deve incluir "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Texto inválido: deve corresponder ao padrão ${_issue.pattern}`;
            return `Formato d${FormatDictionary[_issue.format] ?? issue.format} inválido`;
          }
          case "not_multiple_of":
            return `Número inválido: deve ser múltiplo de ${issue.divisor}`;
          case "unrecognized_keys": {
            const plural = issue.keys.length > 1 ? "s" : "";
            return `Chave${plural} inválida${plural}: ${util2.joinValues(issue.keys, ", ")}`;
          }
          case "invalid_key":
            return `Entrada inválida n${translateOriginWithArticle(issue.origin, "definite")}`;
          case "invalid_union":
            if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
              const opts = issue.options.map((o) => `'${o}'`).join(" | ");
              return `Valor de discriminação inválido. Esperava ${opts}`;
            }
            return "Entrada inválida";
          case "invalid_element":
            return `Entrada inválida n${translateOriginWithArticle(issue.origin, "definite")}`;
          default:
            return `Entrada inválida`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ptBR$1, ptBR$1.exports);
  return ptBR$1.exports;
}
var ro$1 = { exports: {} };
var ro = ro$1.exports;
var hasRequiredRo;
function requireRo() {
  if (hasRequiredRo) return ro$1.exports;
  hasRequiredRo = 1;
  (function(module2, exports2) {
    var __createBinding = ro && ro.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ro && ro.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ro && ro.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "caractere", verb: "să aibă" },
        file: { unit: "octeți", verb: "să aibă" },
        array: { unit: "elemente", verb: "să aibă" },
        set: { unit: "elemente", verb: "să aibă" },
        map: { unit: "intrări", verb: "să aibă" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "intrare",
        email: "adresă de email",
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
        datetime: "dată și oră ISO",
        date: "dată ISO",
        time: "oră ISO",
        duration: "durată ISO",
        ipv4: "adresă IPv4",
        ipv6: "adresă IPv6",
        mac: "adresă MAC",
        cidrv4: "interval IPv4",
        cidrv6: "interval IPv6",
        base64: "șir codat base64",
        base64url: "șir codat base64url",
        json_string: "șir JSON",
        e164: "număr E.164",
        credit_card: "număr de card de credit",
        currency_code: "cod valutar",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "intrare"
      };
      const TypeDictionary = {
        nan: "NaN",
        string: "șir",
        number: "număr",
        boolean: "boolean",
        function: "funcție",
        array: "matrice",
        object: "obiect",
        undefined: "nedefinit",
        symbol: "simbol",
        bigint: "număr mare",
        void: "void",
        never: "never",
        map: "hartă",
        set: "set"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            return `Intrare invalidă: așteptat ${expected}, primit ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Intrare invalidă: așteptat ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Opțiune invalidă: așteptat una dintre ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Prea mare: așteptat ca ${issue.origin ?? "valoarea"} ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elemente"}`;
            return `Prea mare: așteptat ca ${issue.origin ?? "valoarea"} să fie ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Prea mic: așteptat ca ${issue.origin} ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Prea mic: așteptat ca ${issue.origin} să fie ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Șir invalid: trebuie să înceapă cu "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Șir invalid: trebuie să se termine cu "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Șir invalid: trebuie să includă "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Șir invalid: trebuie să se potrivească cu modelul ${_issue.pattern}`;
            return `Format invalid: ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Număr invalid: trebuie să fie multiplu de ${issue.divisor}`;
          case "unrecognized_keys":
            return `Chei nerecunoscute: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Cheie invalidă în ${issue.origin}`;
          case "invalid_union":
            return "Intrare invalidă";
          case "invalid_element":
            return `Valoare invalidă în ${issue.origin}`;
          default:
            return `Intrare invalidă`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ro$1, ro$1.exports);
  return ro$1.exports;
}
var ru$1 = { exports: {} };
var ru = ru$1.exports;
var hasRequiredRu;
function requireRu() {
  if (hasRequiredRu) return ru$1.exports;
  hasRequiredRu = 1;
  (function(module2, exports2) {
    var __createBinding = ru && ru.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ru && ru.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ru && ru.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    function getRussianPlural(count, one, few, many) {
      const absCount = Math.abs(count);
      const lastDigit = absCount % 10;
      const lastTwoDigits = absCount % 100;
      if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
        return many;
      }
      if (lastDigit === 1) {
        return one;
      }
      if (lastDigit >= 2 && lastDigit <= 4) {
        return few;
      }
      return many;
    }
    const error = () => {
      const Sizable = {
        string: {
          unit: {
            one: "символ",
            few: "символа",
            many: "символов"
          },
          verb: "иметь"
        },
        file: {
          unit: {
            one: "байт",
            few: "байта",
            many: "байт"
          },
          verb: "иметь"
        },
        array: {
          unit: {
            one: "элемент",
            few: "элемента",
            many: "элементов"
          },
          verb: "иметь"
        },
        set: {
          unit: {
            one: "элемент",
            few: "элемента",
            many: "элементов"
          },
          verb: "иметь"
        },
        map: {
          unit: {
            one: "элемент",
            few: "элемента",
            many: "элементов"
          },
          verb: "иметь"
        }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "ввод",
        email: "email адрес",
        url: "URL",
        emoji: "эмодзи",
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
        datetime: "ISO дата и время",
        date: "ISO дата",
        time: "ISO время",
        duration: "ISO длительность",
        ipv4: "IPv4 адрес",
        ipv6: "IPv6 адрес",
        mac: "MAC адрес",
        cidrv4: "IPv4 диапазон",
        cidrv6: "IPv6 диапазон",
        base64: "строка в формате base64",
        base64url: "строка в формате base64url",
        json_string: "JSON строка",
        e164: "номер E.164",
        credit_card: "номер кредитной карты",
        currency_code: "код валюты",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "ввод"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "число",
        array: "массив"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Неверный ввод: ожидалось instanceof ${issue.expected}, получено ${received}`;
            }
            return `Неверный ввод: ожидалось ${expected}, получено ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Неверный ввод: ожидалось ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Неверный вариант: ожидалось одно из ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              const maxValue = Number(issue.maximum);
              const unit = getRussianPlural(maxValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
              return `Слишком большое значение: ожидалось, что ${issue.origin ?? "значение"} будет иметь ${adj}${issue.maximum.toString()} ${unit}`;
            }
            return `Слишком большое значение: ожидалось, что ${issue.origin ?? "значение"} будет ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              const minValue = Number(issue.minimum);
              const unit = getRussianPlural(minValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
              return `Слишком маленькое значение: ожидалось, что ${issue.origin} будет иметь ${adj}${issue.minimum.toString()} ${unit}`;
            }
            return `Слишком маленькое значение: ожидалось, что ${issue.origin} будет ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Неверная строка: должна начинаться с "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Неверная строка: должна заканчиваться на "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Неверная строка: должна содержать "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Неверная строка: должна соответствовать шаблону ${_issue.pattern}`;
            return `Неверный ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Неверное число: должно быть кратным ${issue.divisor}`;
          case "unrecognized_keys":
            return `Нераспознанн${issue.keys.length > 1 ? "ые" : "ый"} ключ${issue.keys.length > 1 ? "и" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Неверный ключ в ${issue.origin}`;
          case "invalid_union":
            return "Неверные входные данные";
          case "invalid_element":
            return `Неверное значение в ${issue.origin}`;
          default:
            return `Неверные входные данные`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ru$1, ru$1.exports);
  return ru$1.exports;
}
var sk$1 = { exports: {} };
var sk = sk$1.exports;
var hasRequiredSk;
function requireSk() {
  if (hasRequiredSk) return sk$1.exports;
  hasRequiredSk = 1;
  (function(module2, exports2) {
    var __createBinding = sk && sk.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = sk && sk.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = sk && sk.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "znakov", verb: "mať" },
        file: { unit: "bajtov", verb: "mať" },
        array: { unit: "prvkov", verb: "mať" },
        set: { unit: "prvkov", verb: "mať" },
        map: { unit: "položiek", verb: "mať" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "regulárny výraz",
        email: "e-mailová adresa",
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
        datetime: "dátum a čas vo formáte ISO",
        date: "dátum vo formáte ISO",
        time: "čas vo formáte ISO",
        duration: "doba trvania ISO",
        ipv4: "IPv4 adresa",
        ipv6: "IPv6 adresa",
        mac: "MAC adresa",
        cidrv4: "rozsah IPv4",
        cidrv6: "rozsah IPv6",
        base64: "reťazec zakódovaný vo formáte base64",
        base64url: "reťazec zakódovaný vo formáte base64url",
        json_string: "reťazec vo formáte JSON",
        e164: "číslo E.164",
        credit_card: "číslo kreditnej karty",
        currency_code: "kód meny",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "vstup"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "číslo",
        string: "reťazec",
        function: "funkcia",
        array: "pole"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Neplatný vstup: očakávané instanceof ${issue.expected}, obdržané ${received}`;
            }
            return `Neplatný vstup: očakávané ${expected}, obdržané ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Neplatný vstup: očakávané ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Neplatný vstup: očakávaná jedna z hodnôt ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Hodnota je príliš veľká: ${issue.origin ?? "hodnota"} musí mať ${adj}${issue.maximum.toString()} ${sizing.unit ?? "prvkov"}`;
            }
            return `Hodnota je príliš veľká: ${issue.origin ?? "hodnota"} musí byť ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Hodnota je príliš malá: ${issue.origin ?? "hodnota"} musí mať ${adj}${issue.minimum.toString()} ${sizing.unit ?? "prvkov"}`;
            }
            return `Hodnota je príliš malá: ${issue.origin ?? "hodnota"} musí byť ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Neplatný reťazec: musí začínať na "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Neplatný reťazec: musí končiť na "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Neplatný reťazec: musí obsahovať "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Neplatný reťazec: musí zodpovedať vzoru ${_issue.pattern}`;
            return `Neplatný formát ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Neplatné číslo: musí byť násobkom ${issue.divisor}`;
          case "unrecognized_keys":
            return `Neznáme klúče: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Neplatný klúč v ${issue.origin}`;
          case "invalid_union":
            return "Neplatný vstup";
          case "invalid_element":
            return `Neplatná hodnota v ${issue.origin}`;
          default:
            return `Neplatný vstup`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(sk$1, sk$1.exports);
  return sk$1.exports;
}
var sl$1 = { exports: {} };
var sl = sl$1.exports;
var hasRequiredSl;
function requireSl() {
  if (hasRequiredSl) return sl$1.exports;
  hasRequiredSl = 1;
  (function(module2, exports2) {
    var __createBinding = sl && sl.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = sl && sl.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = sl && sl.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "znakov", verb: "imeti" },
        file: { unit: "bajtov", verb: "imeti" },
        array: { unit: "elementov", verb: "imeti" },
        set: { unit: "elementov", verb: "imeti" },
        map: { unit: "elementov", verb: "imeti" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "vnos",
        email: "e-poštni naslov",
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
        datetime: "ISO datum in čas",
        date: "ISO datum",
        time: "ISO čas",
        duration: "ISO trajanje",
        ipv4: "IPv4 naslov",
        ipv6: "IPv6 naslov",
        mac: "MAC naslov",
        cidrv4: "obseg IPv4",
        cidrv6: "obseg IPv6",
        base64: "base64 kodiran niz",
        base64url: "base64url kodiran niz",
        json_string: "JSON niz",
        e164: "E.164 številka",
        credit_card: "številka kreditne kartice",
        currency_code: "koda valute",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "vnos"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "število",
        array: "tabela"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Neveljaven vnos: pričakovano instanceof ${issue.expected}, prejeto ${received}`;
            }
            return `Neveljaven vnos: pričakovano ${expected}, prejeto ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Neveljaven vnos: pričakovano ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Neveljavna možnost: pričakovano eno izmed ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Preveliko: pričakovano, da bo ${issue.origin ?? "vrednost"} imelo ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementov"}`;
            return `Preveliko: pričakovano, da bo ${issue.origin ?? "vrednost"} ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Premajhno: pričakovano, da bo ${issue.origin} imelo ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Premajhno: pričakovano, da bo ${issue.origin} ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Neveljaven niz: mora se začeti z "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Neveljaven niz: mora se končati z "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Neveljaven niz: mora vsebovati "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Neveljaven niz: mora ustrezati vzorcu ${_issue.pattern}`;
            return `Neveljaven ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Neveljavno število: mora biti večkratnik ${issue.divisor}`;
          case "unrecognized_keys":
            return `Neprepoznan${issue.keys.length > 1 ? "i ključi" : " ključ"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Neveljaven ključ v ${issue.origin}`;
          case "invalid_union":
            return "Neveljaven vnos";
          case "invalid_element":
            return `Neveljavna vrednost v ${issue.origin}`;
          default:
            return "Neveljaven vnos";
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(sl$1, sl$1.exports);
  return sl$1.exports;
}
var sv$1 = { exports: {} };
var sv = sv$1.exports;
var hasRequiredSv;
function requireSv() {
  if (hasRequiredSv) return sv$1.exports;
  hasRequiredSv = 1;
  (function(module2, exports2) {
    var __createBinding = sv && sv.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = sv && sv.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = sv && sv.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "tecken", verb: "att ha" },
        file: { unit: "bytes", verb: "att ha" },
        array: { unit: "objekt", verb: "att innehålla" },
        set: { unit: "objekt", verb: "att innehålla" },
        map: { unit: "objekt", verb: "att innehålla" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "reguljärt uttryck",
        email: "e-postadress",
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
        datetime: "ISO-datum och tid",
        date: "ISO-datum",
        time: "ISO-tid",
        duration: "ISO-varaktighet",
        ipv4: "IPv4-adress",
        ipv6: "IPv6-adress",
        mac: "MAC-adress",
        cidrv4: "IPv4-spektrum",
        cidrv6: "IPv6-spektrum",
        base64: "base64-kodad sträng",
        base64url: "base64url-kodad sträng",
        json_string: "JSON-sträng",
        e164: "E.164-nummer",
        credit_card: "kreditkortsnummer",
        currency_code: "valutakod",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "mall-literal"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "antal",
        array: "lista"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Ogiltig inmatning: förväntat instanceof ${issue.expected}, fick ${received}`;
            }
            return `Ogiltig inmatning: förväntat ${expected}, fick ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Ogiltig inmatning: förväntat ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Ogiltigt val: förväntade en av ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `För stor(t): förväntade ${issue.origin ?? "värdet"} att ha ${adj}${issue.maximum.toString()} ${sizing.unit ?? "element"}`;
            }
            return `För stor(t): förväntat ${issue.origin ?? "värdet"} att ha ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `För lite(t): förväntade ${issue.origin ?? "värdet"} att ha ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `För lite(t): förväntade ${issue.origin ?? "värdet"} att ha ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `Ogiltig sträng: måste börja med "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `Ogiltig sträng: måste sluta med "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Ogiltig sträng: måste innehålla "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Ogiltig sträng: måste matcha mönstret "${_issue.pattern}"`;
            return `Ogiltig(t) ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Ogiltigt tal: måste vara en multipel av ${issue.divisor}`;
          case "unrecognized_keys":
            return `${issue.keys.length > 1 ? "Okända nycklar" : "Okänd nyckel"}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Ogiltig nyckel i ${issue.origin ?? "värdet"}`;
          case "invalid_union":
            return "Ogiltig input";
          case "invalid_element":
            return `Ogiltigt värde i ${issue.origin ?? "värdet"}`;
          default:
            return `Ogiltig input`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(sv$1, sv$1.exports);
  return sv$1.exports;
}
var ta$1 = { exports: {} };
var ta = ta$1.exports;
var hasRequiredTa;
function requireTa() {
  if (hasRequiredTa) return ta$1.exports;
  hasRequiredTa = 1;
  (function(module2, exports2) {
    var __createBinding = ta && ta.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ta && ta.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ta && ta.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "எழுத்துக்கள்", verb: "கொண்டிருக்க வேண்டும்" },
        file: { unit: "பைட்டுகள்", verb: "கொண்டிருக்க வேண்டும்" },
        array: { unit: "உறுப்புகள்", verb: "கொண்டிருக்க வேண்டும்" },
        set: { unit: "உறுப்புகள்", verb: "கொண்டிருக்க வேண்டும்" },
        map: { unit: "உறுப்புகள்", verb: "கொண்டிருக்க வேண்டும்" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "உள்ளீடு",
        email: "மின்னஞ்சல் முகவரி",
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
        datetime: "ISO தேதி நேரம்",
        date: "ISO தேதி",
        time: "ISO நேரம்",
        duration: "ISO கால அளவு",
        ipv4: "IPv4 முகவரி",
        ipv6: "IPv6 முகவரி",
        mac: "MAC முகவரி",
        cidrv4: "IPv4 வரம்பு",
        cidrv6: "IPv6 வரம்பு",
        base64: "base64-encoded சரம்",
        base64url: "base64url-encoded சரம்",
        json_string: "JSON சரம்",
        e164: "E.164 எண்",
        credit_card: "கடன் அட்டை எண்",
        currency_code: "நாணயக் குறியீடு",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "input"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "எண்",
        array: "அணி",
        null: "வெறுமை"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது instanceof ${issue.expected}, பெறப்பட்டது ${received}`;
            }
            return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது ${expected}, பெறப்பட்டது ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது ${util2.stringifyPrimitive(issue.values[0])}`;
            return `தவறான விருப்பம்: எதிர்பார்க்கப்பட்டது ${util2.joinValues(issue.values, "|")} இல் ஒன்று`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `மிக பெரியது: எதிர்பார்க்கப்பட்டது ${issue.origin ?? "மதிப்பு"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "உறுப்புகள்"} ஆக இருக்க வேண்டும்`;
            }
            return `மிக பெரியது: எதிர்பார்க்கப்பட்டது ${issue.origin ?? "மதிப்பு"} ${adj}${issue.maximum.toString()} ஆக இருக்க வேண்டும்`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `மிகச் சிறியது: எதிர்பார்க்கப்பட்டது ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit} ஆக இருக்க வேண்டும்`;
            }
            return `மிகச் சிறியது: எதிர்பார்க்கப்பட்டது ${issue.origin} ${adj}${issue.minimum.toString()} ஆக இருக்க வேண்டும்`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `தவறான சரம்: "${_issue.prefix}" இல் தொடங்க வேண்டும்`;
            if (_issue.format === "ends_with")
              return `தவறான சரம்: "${_issue.suffix}" இல் முடிவடைய வேண்டும்`;
            if (_issue.format === "includes")
              return `தவறான சரம்: "${_issue.includes}" ஐ உள்ளடக்க வேண்டும்`;
            if (_issue.format === "regex")
              return `தவறான சரம்: ${_issue.pattern} முறைபாட்டுடன் பொருந்த வேண்டும்`;
            return `தவறான ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `தவறான எண்: ${issue.divisor} இன் பலமாக இருக்க வேண்டும்`;
          case "unrecognized_keys":
            return `அடையாளம் தெரியாத விசை${issue.keys.length > 1 ? "கள்" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `${issue.origin} இல் தவறான விசை`;
          case "invalid_union":
            return "தவறான உள்ளீடு";
          case "invalid_element":
            return `${issue.origin} இல் தவறான மதிப்பு`;
          default:
            return `தவறான உள்ளீடு`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ta$1, ta$1.exports);
  return ta$1.exports;
}
var tg$1 = { exports: {} };
var tg = tg$1.exports;
var hasRequiredTg;
function requireTg() {
  if (hasRequiredTg) return tg$1.exports;
  hasRequiredTg = 1;
  (function(module2, exports2) {
    var __createBinding = tg && tg.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = tg && tg.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = tg && tg.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "аломат", verb: "дошта бошад" },
        file: { unit: "байт", verb: "дошта бошад" },
        array: { unit: "унсур", verb: "дошта бошад" },
        set: { unit: "унсур", verb: "дошта бошад" },
        map: { unit: "сабт", verb: "дошта бошад" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "вуруд",
        email: "суроғаи email",
        url: "URL",
        emoji: "эмоҷи",
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
        datetime: "санаву вақти ISO",
        date: "санаи ISO",
        time: "вақти ISO",
        duration: "давомнокии ISO",
        ipv4: "суроғаи IPv4",
        ipv6: "суроғаи IPv6",
        mac: "суроғаи MAC",
        cidrv4: "маҳдудаи IPv4",
        cidrv6: "маҳдудаи IPv6",
        base64: "сатри дар формати base64",
        base64url: "сатри дар формати base64url",
        json_string: "сатри JSON",
        e164: "рақами E.164",
        credit_card: "рақами корти кредитӣ",
        currency_code: "рамзи асъор",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "вуруд"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "рақам",
        string: "сатр",
        array: "массив",
        object: "объект",
        date: "сана"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            return `Вуруди нодуруст: ${expected} интизор мерафт, ${received} гирифта шуд`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Вуруди нодуруст: ${util2.stringifyPrimitive(issue.values[0])} интизор мерафт`;
            return `Интихоби нодуруст: яке аз ${util2.joinValues(issue.values, "|")} интизор мерафт`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Хеле калон: ${issue.origin ?? "қимат"} бояд ${adj}${issue.maximum.toString()} ${sizing.unit} ${sizing.verb}`;
            return `Хеле калон: ${issue.origin ?? "қимат"} бояд ${adj}${issue.maximum.toString()} бошад`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Хеле хурд: ${issue.origin} бояд ${adj}${issue.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
            return `Хеле хурд: ${issue.origin} бояд ${adj}${issue.minimum.toString()} бошад`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Сатри нодуруст: бояд бо "${_issue.prefix}" оғоз шавад`;
            if (_issue.format === "ends_with")
              return `Сатри нодуруст: бояд бо "${_issue.suffix}" анҷом ёбад`;
            if (_issue.format === "includes")
              return `Сатри нодуруст: бояд "${_issue.includes}"-ро дар бар гирад`;
            if (_issue.format === "regex")
              return `Сатри нодуруст: бояд ба намунаи ${_issue.pattern} мувофиқат кунад`;
            return `${FormatDictionary[_issue.format] ?? issue.format}-и нодуруст`;
          }
          case "not_multiple_of":
            return `Рақами нодуруст: бояд ба ${issue.divisor} бе бақия тақсим шавад`;
          case "unrecognized_keys":
            return `Калид${issue.keys.length > 1 ? "ҳои" : "и"} номаълум: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Калиди нодуруст дар ${issue.origin}`;
          case "invalid_union":
            if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
              const opts = issue.options.map((o) => `'${o}'`).join(" | ");
              return `Қимати нодурусти дискриминатор: ${opts} интизор мерафт`;
            }
            return "Вуруди нодуруст";
          case "invalid_element":
            return `Қимати нодуруст дар ${issue.origin}`;
          default:
            return `Вуруди нодуруст`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(tg$1, tg$1.exports);
  return tg$1.exports;
}
var th$1 = { exports: {} };
var th = th$1.exports;
var hasRequiredTh;
function requireTh() {
  if (hasRequiredTh) return th$1.exports;
  hasRequiredTh = 1;
  (function(module2, exports2) {
    var __createBinding = th && th.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = th && th.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = th && th.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "ตัวอักษร", verb: "ควรมี" },
        file: { unit: "ไบต์", verb: "ควรมี" },
        array: { unit: "รายการ", verb: "ควรมี" },
        set: { unit: "รายการ", verb: "ควรมี" },
        map: { unit: "รายการ", verb: "ควรมี" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "ข้อมูลที่ป้อน",
        email: "ที่อยู่อีเมล",
        url: "URL",
        emoji: "อิโมจิ",
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
        datetime: "วันที่เวลาแบบ ISO",
        date: "วันที่แบบ ISO",
        time: "เวลาแบบ ISO",
        duration: "ช่วงเวลาแบบ ISO",
        ipv4: "ที่อยู่ IPv4",
        ipv6: "ที่อยู่ IPv6",
        mac: "ที่อยู่ MAC",
        cidrv4: "ช่วง IP แบบ IPv4",
        cidrv6: "ช่วง IP แบบ IPv6",
        base64: "ข้อความแบบ Base64",
        base64url: "ข้อความแบบ Base64 สำหรับ URL",
        json_string: "ข้อความแบบ JSON",
        e164: "เบอร์โทรศัพท์ระหว่างประเทศ (E.164)",
        credit_card: "หมายเลขบัตรเครดิต",
        currency_code: "รหัสสกุลเงิน",
        iban: "IBAN",
        jwt: "โทเคน JWT",
        template_literal: "ข้อมูลที่ป้อน"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "ตัวเลข",
        array: "อาร์เรย์ (Array)",
        null: "ไม่มีค่า (null)"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `ประเภทข้อมูลไม่ถูกต้อง: ควรเป็น instanceof ${issue.expected} แต่ได้รับ ${received}`;
            }
            return `ประเภทข้อมูลไม่ถูกต้อง: ควรเป็น ${expected} แต่ได้รับ ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `ค่าไม่ถูกต้อง: ควรเป็น ${util2.stringifyPrimitive(issue.values[0])}`;
            return `ตัวเลือกไม่ถูกต้อง: ควรเป็นหนึ่งใน ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "ไม่เกิน" : "น้อยกว่า";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `เกินกำหนด: ${issue.origin ?? "ค่า"} ควรมี${adj} ${issue.maximum.toString()} ${sizing.unit ?? "รายการ"}`;
            return `เกินกำหนด: ${issue.origin ?? "ค่า"} ควรมี${adj} ${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? "อย่างน้อย" : "มากกว่า";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `น้อยกว่ากำหนด: ${issue.origin} ควรมี${adj} ${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `น้อยกว่ากำหนด: ${issue.origin} ควรมี${adj} ${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `รูปแบบไม่ถูกต้อง: ข้อความต้องขึ้นต้นด้วย "${_issue.prefix}"`;
            }
            if (_issue.format === "ends_with")
              return `รูปแบบไม่ถูกต้อง: ข้อความต้องลงท้ายด้วย "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `รูปแบบไม่ถูกต้อง: ข้อความต้องมี "${_issue.includes}" อยู่ในข้อความ`;
            if (_issue.format === "regex")
              return `รูปแบบไม่ถูกต้อง: ต้องตรงกับรูปแบบที่กำหนด ${_issue.pattern}`;
            return `รูปแบบไม่ถูกต้อง: ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `ตัวเลขไม่ถูกต้อง: ต้องเป็นจำนวนที่หารด้วย ${issue.divisor} ได้ลงตัว`;
          case "unrecognized_keys":
            return `พบคีย์ที่ไม่รู้จัก: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `คีย์ไม่ถูกต้องใน ${issue.origin}`;
          case "invalid_union":
            return "ข้อมูลไม่ถูกต้อง: ไม่ตรงกับรูปแบบยูเนียนที่กำหนดไว้";
          case "invalid_element":
            return `ข้อมูลไม่ถูกต้องใน ${issue.origin}`;
          default:
            return `ข้อมูลไม่ถูกต้อง`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(th$1, th$1.exports);
  return th$1.exports;
}
var tk$1 = { exports: {} };
var tk = tk$1.exports;
var hasRequiredTk;
function requireTk() {
  if (hasRequiredTk) return tk$1.exports;
  hasRequiredTk = 1;
  (function(module2, exports2) {
    var __createBinding = tk && tk.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = tk && tk.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = tk && tk.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "simwol", verb: "bolmaly" },
        file: { unit: "baýt", verb: "bolmaly" },
        array: { unit: "elementler", verb: "bolmaly" },
        set: { unit: "elementler", verb: "bolmaly" },
        map: { unit: "elementler", verb: "bolmaly" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "giriş",
        email: "e-poçta salgysy",
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
        datetime: "ISO sene we wagt",
        date: "ISO sene",
        time: "ISO wagt",
        duration: "ISO wagt aralygy",
        ipv4: "IPv4 salgysy",
        ipv6: "IPv6 salgysy",
        mac: "MAC salgysy",
        cidrv4: "IPv4 aralygy",
        cidrv6: "IPv6 aralygy",
        base64: "base64 bilen şifrlenen setir",
        base64url: "base64url bilen şifrlenen setir",
        json_string: "JSON setiri",
        e164: "E.164 nomeri",
        credit_card: "kredit kartynyň nomeri",
        currency_code: "walýuta kody",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "şablon"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            return `Nädogry baha: garaşylan ${expected} ýerine ${received} alyndy`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Nädogry baha: ${util2.stringifyPrimitive(issue.values[0])} bolmaly`;
            return `Nädogry saýlaw: aşakdakylardan biri bolmaly: ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Has uly: garaşylýan ${issue.origin ?? "baha"} ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "element"}`;
            return `Has uly: garaşylýan ${issue.origin ?? "baha"} ${adj} ${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Has kiçi: garaşylýan ${issue.origin} ${adj} ${issue.minimum.toString()} ${sizing.unit}`;
            return `Has kiçi: garaşylýan ${issue.origin} ${adj} ${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Nädogry setir: "${_issue.prefix}" bilen başlamaly`;
            if (_issue.format === "ends_with")
              return `Nädogry setir: "${_issue.suffix}" bilen gutarmaly`;
            if (_issue.format === "includes")
              return `Nädogry setir: "${_issue.includes}" saklamaly`;
            if (_issue.format === "regex")
              return `Nädogry setir: ${_issue.pattern} nusga laýyk bolmaly`;
            return `Nädogry ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Nädogry san: ${issue.divisor} bilen galyndysyz bölünmeli`;
          case "unrecognized_keys":
            return `Tanalmaýan açar${issue.keys.length > 1 ? "lar" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `${issue.origin} içinde nädogry açar`;
          case "invalid_union":
            return "Nädogry baha";
          case "invalid_element":
            return `${issue.origin} içinde nädogry baha`;
          default:
            return `Nädogry baha`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(tk$1, tk$1.exports);
  return tk$1.exports;
}
var tr$1 = { exports: {} };
var tr = tr$1.exports;
var hasRequiredTr;
function requireTr() {
  if (hasRequiredTr) return tr$1.exports;
  hasRequiredTr = 1;
  (function(module2, exports2) {
    var __createBinding = tr && tr.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = tr && tr.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = tr && tr.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "karakter", verb: "olmalı" },
        file: { unit: "bayt", verb: "olmalı" },
        array: { unit: "öğe", verb: "olmalı" },
        set: { unit: "öğe", verb: "olmalı" },
        map: { unit: "öğe", verb: "olmalı" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "girdi",
        email: "e-posta adresi",
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
        datetime: "ISO tarih ve saat",
        date: "ISO tarih",
        time: "ISO saat",
        duration: "ISO süre",
        ipv4: "IPv4 adresi",
        ipv6: "IPv6 adresi",
        mac: "MAC adresi",
        cidrv4: "IPv4 aralığı",
        cidrv6: "IPv6 aralığı",
        base64: "base64 ile şifrelenmiş metin",
        base64url: "base64url ile şifrelenmiş metin",
        json_string: "JSON dizesi",
        e164: "E.164 sayısı",
        credit_card: "kredi kartı numarası",
        currency_code: "para birimi kodu",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "Şablon dizesi"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Geçersiz değer: beklenen instanceof ${issue.expected}, alınan ${received}`;
            }
            return `Geçersiz değer: beklenen ${expected}, alınan ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Geçersiz değer: beklenen ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Geçersiz seçenek: aşağıdakilerden biri olmalı: ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Çok büyük: beklenen ${issue.origin ?? "değer"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "öğe"}`;
            return `Çok büyük: beklenen ${issue.origin ?? "değer"} ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Çok küçük: beklenen ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            return `Çok küçük: beklenen ${issue.origin} ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Geçersiz metin: "${_issue.prefix}" ile başlamalı`;
            if (_issue.format === "ends_with")
              return `Geçersiz metin: "${_issue.suffix}" ile bitmeli`;
            if (_issue.format === "includes")
              return `Geçersiz metin: "${_issue.includes}" içermeli`;
            if (_issue.format === "regex")
              return `Geçersiz metin: ${_issue.pattern} desenine uymalı`;
            return `Geçersiz ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Geçersiz sayı: ${issue.divisor} ile tam bölünebilmeli`;
          case "unrecognized_keys":
            return `Tanınmayan anahtar${issue.keys.length > 1 ? "lar" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `${issue.origin} içinde geçersiz anahtar`;
          case "invalid_union":
            return "Geçersiz değer";
          case "invalid_element":
            return `${issue.origin} içinde geçersiz değer`;
          default:
            return `Geçersiz değer`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(tr$1, tr$1.exports);
  return tr$1.exports;
}
var ua$1 = { exports: {} };
var uk$1 = { exports: {} };
var uk = uk$1.exports;
var hasRequiredUk;
function requireUk() {
  if (hasRequiredUk) return uk$1.exports;
  hasRequiredUk = 1;
  (function(module2, exports2) {
    var __createBinding = uk && uk.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = uk && uk.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = uk && uk.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "символів", verb: "матиме" },
        file: { unit: "байтів", verb: "матиме" },
        array: { unit: "елементів", verb: "матиме" },
        set: { unit: "елементів", verb: "матиме" },
        map: { unit: "елементів", verb: "матиме" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "вхідні дані",
        email: "адреса електронної пошти",
        url: "URL",
        emoji: "емодзі",
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
        datetime: "дата та час ISO",
        date: "дата ISO",
        time: "час ISO",
        duration: "тривалість ISO",
        ipv4: "адреса IPv4",
        ipv6: "адреса IPv6",
        mac: "адреса MAC",
        cidrv4: "діапазон IPv4",
        cidrv6: "діапазон IPv6",
        base64: "рядок у кодуванні base64",
        base64url: "рядок у кодуванні base64url",
        json_string: "рядок JSON",
        e164: "номер E.164",
        credit_card: "номер кредитної картки",
        currency_code: "код валюти",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "вхідні дані"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "число",
        array: "масив"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Неправильні вхідні дані: очікується instanceof ${issue.expected}, отримано ${received}`;
            }
            return `Неправильні вхідні дані: очікується ${expected}, отримано ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Неправильні вхідні дані: очікується ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Неправильна опція: очікується одне з ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Занадто велике: очікується, що ${issue.origin ?? "значення"} ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "елементів"}`;
            return `Занадто велике: очікується, що ${issue.origin ?? "значення"} буде ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Занадто мале: очікується, що ${issue.origin} ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Занадто мале: очікується, що ${issue.origin} буде ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Неправильний рядок: повинен починатися з "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Неправильний рядок: повинен закінчуватися на "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Неправильний рядок: повинен містити "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Неправильний рядок: повинен відповідати шаблону ${_issue.pattern}`;
            return `Неправильний ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Неправильне число: повинно бути кратним ${issue.divisor}`;
          case "unrecognized_keys":
            return `Нерозпізнаний ключ${issue.keys.length > 1 ? "і" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Неправильний ключ у ${issue.origin}`;
          case "invalid_union":
            return "Неправильні вхідні дані";
          case "invalid_element":
            return `Неправильне значення у ${issue.origin}`;
          default:
            return `Неправильні вхідні дані`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(uk$1, uk$1.exports);
  return uk$1.exports;
}
var ua = ua$1.exports;
var hasRequiredUa;
function requireUa() {
  if (hasRequiredUa) return ua$1.exports;
  hasRequiredUa = 1;
  (function(module2, exports2) {
    var __importDefault = ua && ua.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const uk_js_1 = __importDefault(/* @__PURE__ */ requireUk());
    function default_1() {
      return (0, uk_js_1.default)();
    }
    module2.exports = exports2.default;
  })(ua$1, ua$1.exports);
  return ua$1.exports;
}
var ur$1 = { exports: {} };
var ur = ur$1.exports;
var hasRequiredUr;
function requireUr() {
  if (hasRequiredUr) return ur$1.exports;
  hasRequiredUr = 1;
  (function(module2, exports2) {
    var __createBinding = ur && ur.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = ur && ur.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = ur && ur.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "حروف", verb: "ہونا" },
        file: { unit: "بائٹس", verb: "ہونا" },
        array: { unit: "آئٹمز", verb: "ہونا" },
        set: { unit: "آئٹمز", verb: "ہونا" },
        map: { unit: "آئٹمز", verb: "ہونا" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "ان پٹ",
        email: "ای میل ایڈریس",
        url: "یو آر ایل",
        emoji: "ایموجی",
        uuid: "یو یو آئی ڈی",
        uuidv4: "یو یو آئی ڈی وی 4",
        uuidv6: "یو یو آئی ڈی وی 6",
        nanoid: "نینو آئی ڈی",
        guid: "جی یو آئی ڈی",
        cuid: "سی یو آئی ڈی",
        cuid2: "سی یو آئی ڈی 2",
        ulid: "یو ایل آئی ڈی",
        xid: "ایکس آئی ڈی",
        ksuid: "کے ایس یو آئی ڈی",
        datetime: "آئی ایس او ڈیٹ ٹائم",
        date: "آئی ایس او تاریخ",
        time: "آئی ایس او وقت",
        duration: "آئی ایس او مدت",
        ipv4: "آئی پی وی 4 ایڈریس",
        ipv6: "آئی پی وی 6 ایڈریس",
        mac: "ایم اے سی ایڈریس",
        cidrv4: "آئی پی وی 4 رینج",
        cidrv6: "آئی پی وی 6 رینج",
        base64: "بیس 64 ان کوڈڈ سٹرنگ",
        base64url: "بیس 64 یو آر ایل ان کوڈڈ سٹرنگ",
        json_string: "جے ایس او این سٹرنگ",
        e164: "ای 164 نمبر",
        credit_card: "کریڈٹ کارڈ نمبر",
        currency_code: "کرنسی کوڈ",
        iban: "IBAN",
        jwt: "جے ڈبلیو ٹی",
        template_literal: "ان پٹ"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "نمبر",
        array: "آرے",
        null: "نل"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `غلط ان پٹ: instanceof ${issue.expected} متوقع تھا، ${received} موصول ہوا`;
            }
            return `غلط ان پٹ: ${expected} متوقع تھا، ${received} موصول ہوا`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `غلط ان پٹ: ${util2.stringifyPrimitive(issue.values[0])} متوقع تھا`;
            return `غلط آپشن: ${util2.joinValues(issue.values, "|")} میں سے ایک متوقع تھا`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `بہت بڑا: ${issue.origin ?? "ویلیو"} کے ${adj}${issue.maximum.toString()} ${sizing.unit ?? "عناصر"} ہونے متوقع تھے`;
            return `بہت بڑا: ${issue.origin ?? "ویلیو"} کا ${adj}${issue.maximum.toString()} ہونا متوقع تھا`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `بہت چھوٹا: ${issue.origin} کے ${adj}${issue.minimum.toString()} ${sizing.unit} ہونے متوقع تھے`;
            }
            return `بہت چھوٹا: ${issue.origin} کا ${adj}${issue.minimum.toString()} ہونا متوقع تھا`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `غلط سٹرنگ: "${_issue.prefix}" سے شروع ہونا چاہیے`;
            }
            if (_issue.format === "ends_with")
              return `غلط سٹرنگ: "${_issue.suffix}" پر ختم ہونا چاہیے`;
            if (_issue.format === "includes")
              return `غلط سٹرنگ: "${_issue.includes}" شامل ہونا چاہیے`;
            if (_issue.format === "regex")
              return `غلط سٹرنگ: پیٹرن ${_issue.pattern} سے میچ ہونا چاہیے`;
            return `غلط ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `غلط نمبر: ${issue.divisor} کا مضاعف ہونا چاہیے`;
          case "unrecognized_keys":
            return `غیر تسلیم شدہ کی${issue.keys.length > 1 ? "ز" : ""}: ${util2.joinValues(issue.keys, "، ")}`;
          case "invalid_key":
            return `${issue.origin} میں غلط کی`;
          case "invalid_union":
            return "غلط ان پٹ";
          case "invalid_element":
            return `${issue.origin} میں غلط ویلیو`;
          default:
            return `غلط ان پٹ`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(ur$1, ur$1.exports);
  return ur$1.exports;
}
var uz$1 = { exports: {} };
var uz = uz$1.exports;
var hasRequiredUz;
function requireUz() {
  if (hasRequiredUz) return uz$1.exports;
  hasRequiredUz = 1;
  (function(module2, exports2) {
    var __createBinding = uz && uz.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = uz && uz.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = uz && uz.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "belgi", verb: "bo‘lishi kerak" },
        file: { unit: "bayt", verb: "bo‘lishi kerak" },
        array: { unit: "element", verb: "bo‘lishi kerak" },
        set: { unit: "element", verb: "bo‘lishi kerak" },
        map: { unit: "yozuv", verb: "bo‘lishi kerak" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "kirish",
        email: "elektron pochta manzili",
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
        datetime: "ISO sana va vaqti",
        date: "ISO sana",
        time: "ISO vaqt",
        duration: "ISO davomiylik",
        ipv4: "IPv4 manzil",
        ipv6: "IPv6 manzil",
        mac: "MAC manzil",
        cidrv4: "IPv4 diapazon",
        cidrv6: "IPv6 diapazon",
        base64: "base64 kodlangan satr",
        base64url: "base64url kodlangan satr",
        json_string: "JSON satr",
        e164: "E.164 raqam",
        credit_card: "kredit karta raqami",
        currency_code: "valyuta kodi",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "kirish"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "raqam",
        array: "massiv"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Noto‘g‘ri kirish: kutilgan instanceof ${issue.expected}, qabul qilingan ${received}`;
            }
            return `Noto‘g‘ri kirish: kutilgan ${expected}, qabul qilingan ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Noto‘g‘ri kirish: kutilgan ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Noto‘g‘ri variant: quyidagilardan biri kutilgan ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Juda katta: kutilgan ${issue.origin ?? "qiymat"} ${adj}${issue.maximum.toString()} ${sizing.unit} ${sizing.verb}`;
            return `Juda katta: kutilgan ${issue.origin ?? "qiymat"} ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Juda kichik: kutilgan ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
            }
            return `Juda kichik: kutilgan ${issue.origin} ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Noto‘g‘ri satr: "${_issue.prefix}" bilan boshlanishi kerak`;
            if (_issue.format === "ends_with")
              return `Noto‘g‘ri satr: "${_issue.suffix}" bilan tugashi kerak`;
            if (_issue.format === "includes")
              return `Noto‘g‘ri satr: "${_issue.includes}" ni o‘z ichiga olishi kerak`;
            if (_issue.format === "regex")
              return `Noto‘g‘ri satr: ${_issue.pattern} shabloniga mos kelishi kerak`;
            return `Noto‘g‘ri ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Noto‘g‘ri raqam: ${issue.divisor} ning karralisi bo‘lishi kerak`;
          case "unrecognized_keys":
            return `Noma’lum kalit${issue.keys.length > 1 ? "lar" : ""}: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `${issue.origin} dagi kalit noto‘g‘ri`;
          case "invalid_union":
            return "Noto‘g‘ri kirish";
          case "invalid_element":
            return `${issue.origin} da noto‘g‘ri qiymat`;
          default:
            return `Noto‘g‘ri kirish`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(uz$1, uz$1.exports);
  return uz$1.exports;
}
var vi$1 = { exports: {} };
var vi = vi$1.exports;
var hasRequiredVi;
function requireVi() {
  if (hasRequiredVi) return vi$1.exports;
  hasRequiredVi = 1;
  (function(module2, exports2) {
    var __createBinding = vi && vi.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = vi && vi.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = vi && vi.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "ký tự", verb: "có" },
        file: { unit: "byte", verb: "có" },
        array: { unit: "phần tử", verb: "có" },
        set: { unit: "phần tử", verb: "có" },
        map: { unit: "phần tử", verb: "có" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "đầu vào",
        email: "địa chỉ email",
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
        datetime: "ngày giờ ISO",
        date: "ngày ISO",
        time: "giờ ISO",
        duration: "khoảng thời gian ISO",
        ipv4: "địa chỉ IPv4",
        ipv6: "địa chỉ IPv6",
        mac: "địa chỉ MAC",
        cidrv4: "dải IPv4",
        cidrv6: "dải IPv6",
        base64: "chuỗi mã hóa base64",
        base64url: "chuỗi mã hóa base64url",
        json_string: "chuỗi JSON",
        e164: "số E.164",
        credit_card: "số thẻ tín dụng",
        currency_code: "mã tiền tệ",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "đầu vào"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "số",
        array: "mảng"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Đầu vào không hợp lệ: mong đợi instanceof ${issue.expected}, nhận được ${received}`;
            }
            return `Đầu vào không hợp lệ: mong đợi ${expected}, nhận được ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Đầu vào không hợp lệ: mong đợi ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Tùy chọn không hợp lệ: mong đợi một trong các giá trị ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Quá lớn: mong đợi ${issue.origin ?? "giá trị"} ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "phần tử"}`;
            return `Quá lớn: mong đợi ${issue.origin ?? "giá trị"} ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `Quá nhỏ: mong đợi ${issue.origin} ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `Quá nhỏ: mong đợi ${issue.origin} ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Chuỗi không hợp lệ: phải bắt đầu bằng "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Chuỗi không hợp lệ: phải kết thúc bằng "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Chuỗi không hợp lệ: phải bao gồm "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Chuỗi không hợp lệ: phải khớp với mẫu ${_issue.pattern}`;
            return `${FormatDictionary[_issue.format] ?? issue.format} không hợp lệ`;
          }
          case "not_multiple_of":
            return `Số không hợp lệ: phải là bội số của ${issue.divisor}`;
          case "unrecognized_keys":
            return `Khóa không được nhận dạng: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Khóa không hợp lệ trong ${issue.origin}`;
          case "invalid_union":
            return "Đầu vào không hợp lệ";
          case "invalid_element":
            return `Giá trị không hợp lệ trong ${issue.origin}`;
          default:
            return `Đầu vào không hợp lệ`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(vi$1, vi$1.exports);
  return vi$1.exports;
}
var zhCN$1 = { exports: {} };
var zhCN = zhCN$1.exports;
var hasRequiredZhCN;
function requireZhCN() {
  if (hasRequiredZhCN) return zhCN$1.exports;
  hasRequiredZhCN = 1;
  (function(module2, exports2) {
    var __createBinding = zhCN && zhCN.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = zhCN && zhCN.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = zhCN && zhCN.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "字符", verb: "包含" },
        file: { unit: "字节", verb: "包含" },
        array: { unit: "项", verb: "包含" },
        set: { unit: "项", verb: "包含" },
        map: { unit: "项", verb: "包含" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "输入",
        email: "电子邮件",
        url: "URL",
        emoji: "表情符号",
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
        datetime: "ISO日期时间",
        date: "ISO日期",
        time: "ISO时间",
        duration: "ISO时长",
        ipv4: "IPv4地址",
        ipv6: "IPv6地址",
        mac: "MAC地址",
        cidrv4: "IPv4网段",
        cidrv6: "IPv6网段",
        base64: "base64编码字符串",
        base64url: "base64url编码字符串",
        json_string: "JSON字符串",
        e164: "E.164号码",
        credit_card: "信用卡号",
        currency_code: "货币代码",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "输入"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "数字",
        array: "数组",
        null: "空值(null)"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `无效输入：期望 instanceof ${issue.expected}，实际接收 ${received}`;
            }
            return `无效输入：期望 ${expected}，实际接收 ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `无效输入：期望 ${util2.stringifyPrimitive(issue.values[0])}`;
            return `无效选项：期望以下之一 ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `数值过大：期望 ${issue.origin ?? "值"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "个元素"}`;
            return `数值过大：期望 ${issue.origin ?? "值"} ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `数值过小：期望 ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `数值过小：期望 ${issue.origin} ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `无效字符串：必须以 "${_issue.prefix}" 开头`;
            if (_issue.format === "ends_with")
              return `无效字符串：必须以 "${_issue.suffix}" 结尾`;
            if (_issue.format === "includes")
              return `无效字符串：必须包含 "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `无效字符串：必须满足正则表达式 ${_issue.pattern}`;
            return `无效${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `无效数字：必须是 ${issue.divisor} 的倍数`;
          case "unrecognized_keys":
            return `出现未知的键(key): ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `${issue.origin} 中的键(key)无效`;
          case "invalid_union":
            return "无效输入";
          case "invalid_element":
            return `${issue.origin} 中包含无效值(value)`;
          default:
            return `无效输入`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(zhCN$1, zhCN$1.exports);
  return zhCN$1.exports;
}
var zhTW$1 = { exports: {} };
var zhTW = zhTW$1.exports;
var hasRequiredZhTW;
function requireZhTW() {
  if (hasRequiredZhTW) return zhTW$1.exports;
  hasRequiredZhTW = 1;
  (function(module2, exports2) {
    var __createBinding = zhTW && zhTW.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = zhTW && zhTW.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = zhTW && zhTW.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "字元", verb: "擁有" },
        file: { unit: "位元組", verb: "擁有" },
        array: { unit: "項目", verb: "擁有" },
        set: { unit: "項目", verb: "擁有" },
        map: { unit: "項目", verb: "擁有" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "輸入",
        email: "郵件地址",
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
        datetime: "ISO 日期時間",
        date: "ISO 日期",
        time: "ISO 時間",
        duration: "ISO 期間",
        ipv4: "IPv4 位址",
        ipv6: "IPv6 位址",
        mac: "MAC 位址",
        cidrv4: "IPv4 範圍",
        cidrv6: "IPv6 範圍",
        base64: "base64 編碼字串",
        base64url: "base64url 編碼字串",
        json_string: "JSON 字串",
        e164: "E.164 數值",
        credit_card: "信用卡號",
        currency_code: "貨幣代碼",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "輸入"
      };
      const TypeDictionary = {
        nan: "NaN"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `無效的輸入值：預期為 instanceof ${issue.expected}，但收到 ${received}`;
            }
            return `無效的輸入值：預期為 ${expected}，但收到 ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `無效的輸入值：預期為 ${util2.stringifyPrimitive(issue.values[0])}`;
            return `無效的選項：預期為以下其中之一 ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `數值過大：預期 ${issue.origin ?? "值"} 應為 ${adj}${issue.maximum.toString()} ${sizing.unit ?? "個元素"}`;
            return `數值過大：預期 ${issue.origin ?? "值"} 應為 ${adj}${issue.maximum.toString()}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing) {
              return `數值過小：預期 ${issue.origin} 應為 ${adj}${issue.minimum.toString()} ${sizing.unit}`;
            }
            return `數值過小：預期 ${issue.origin} 應為 ${adj}${issue.minimum.toString()}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with") {
              return `無效的字串：必須以 "${_issue.prefix}" 開頭`;
            }
            if (_issue.format === "ends_with")
              return `無效的字串：必須以 "${_issue.suffix}" 結尾`;
            if (_issue.format === "includes")
              return `無效的字串：必須包含 "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `無效的字串：必須符合格式 ${_issue.pattern}`;
            return `無效的 ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `無效的數字：必須為 ${issue.divisor} 的倍數`;
          case "unrecognized_keys":
            return `無法識別的鍵值${issue.keys.length > 1 ? "們" : ""}：${util2.joinValues(issue.keys, "、")}`;
          case "invalid_key":
            return `${issue.origin} 中有無效的鍵值`;
          case "invalid_union":
            return "無效的輸入值";
          case "invalid_element":
            return `${issue.origin} 中有無效的值`;
          default:
            return `無效的輸入值`;
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(zhTW$1, zhTW$1.exports);
  return zhTW$1.exports;
}
var yo$1 = { exports: {} };
var yo = yo$1.exports;
var hasRequiredYo;
function requireYo() {
  if (hasRequiredYo) return yo$1.exports;
  hasRequiredYo = 1;
  (function(module2, exports2) {
    var __createBinding = yo && yo.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = yo && yo.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = yo && yo.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = default_1;
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    const error = () => {
      const Sizable = {
        string: { unit: "àmi", verb: "ní" },
        file: { unit: "bytes", verb: "ní" },
        array: { unit: "nkan", verb: "ní" },
        set: { unit: "nkan", verb: "ní" },
        map: { unit: "nkan", verb: "ní" }
      };
      function getSizing(origin2) {
        return Sizable[origin2] ?? null;
      }
      const FormatDictionary = {
        regex: "ẹ̀rọ ìbáwọlé",
        email: "àdírẹ́sì ìmẹ́lì",
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
        datetime: "àkókò ISO",
        date: "ọjọ́ ISO",
        time: "àkókò ISO",
        duration: "àkókò tó pé ISO",
        ipv4: "àdírẹ́sì IPv4",
        ipv6: "àdírẹ́sì IPv6",
        mac: "àdírẹ́sì MAC",
        cidrv4: "àgbègbè IPv4",
        cidrv6: "àgbègbè IPv6",
        base64: "ọ̀rọ̀ tí a kọ́ ní base64",
        base64url: "ọ̀rọ̀ base64url",
        json_string: "ọ̀rọ̀ JSON",
        e164: "nọ́mbà E.164",
        credit_card: "nọmba kaadi gbese",
        currency_code: "koodu owó",
        iban: "IBAN",
        jwt: "JWT",
        template_literal: "ẹ̀rọ ìbáwọlé"
      };
      const TypeDictionary = {
        nan: "NaN",
        number: "nọ́mbà",
        array: "akopọ"
      };
      return (issue) => {
        switch (issue.code) {
          case "invalid_type": {
            const expected = TypeDictionary[issue.expected] ?? issue.expected;
            const receivedType = util2.parsedType(issue.input);
            const received = TypeDictionary[receivedType] ?? receivedType;
            if (/^[A-Z]/.test(issue.expected)) {
              return `Ìbáwọlé aṣìṣe: a ní láti fi instanceof ${issue.expected}, àmọ̀ a rí ${received}`;
            }
            return `Ìbáwọlé aṣìṣe: a ní láti fi ${expected}, àmọ̀ a rí ${received}`;
          }
          case "invalid_value":
            if (issue.values.length === 1)
              return `Ìbáwọlé aṣìṣe: a ní láti fi ${util2.stringifyPrimitive(issue.values[0])}`;
            return `Àṣàyàn aṣìṣe: yan ọ̀kan lára ${util2.joinValues(issue.values, "|")}`;
          case "too_big": {
            const adj = issue.inclusive ? "<=" : "<";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Tó pọ̀ jù: a ní láti jẹ́ pé ${issue.origin ?? "iye"} ${sizing.verb} ${adj}${issue.maximum} ${sizing.unit}`;
            return `Tó pọ̀ jù: a ní láti jẹ́ ${adj}${issue.maximum}`;
          }
          case "too_small": {
            const adj = issue.inclusive ? ">=" : ">";
            const sizing = getSizing(issue.origin);
            if (sizing)
              return `Kéré ju: a ní láti jẹ́ pé ${issue.origin} ${sizing.verb} ${adj}${issue.minimum} ${sizing.unit}`;
            return `Kéré ju: a ní láti jẹ́ ${adj}${issue.minimum}`;
          }
          case "invalid_format": {
            const _issue = issue;
            if (_issue.format === "starts_with")
              return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ bẹ̀rẹ̀ pẹ̀lú "${_issue.prefix}"`;
            if (_issue.format === "ends_with")
              return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ parí pẹ̀lú "${_issue.suffix}"`;
            if (_issue.format === "includes")
              return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ ní "${_issue.includes}"`;
            if (_issue.format === "regex")
              return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ bá àpẹẹrẹ mu ${_issue.pattern}`;
            return `Aṣìṣe: ${FormatDictionary[_issue.format] ?? issue.format}`;
          }
          case "not_multiple_of":
            return `Nọ́mbà aṣìṣe: gbọ́dọ̀ jẹ́ èyà pípín ti ${issue.divisor}`;
          case "unrecognized_keys":
            return `Bọtìnì àìmọ̀: ${util2.joinValues(issue.keys, ", ")}`;
          case "invalid_key":
            return `Bọtìnì aṣìṣe nínú ${issue.origin}`;
          case "invalid_union":
            return "Ìbáwọlé aṣìṣe";
          case "invalid_element":
            return `Iye aṣìṣe nínú ${issue.origin}`;
          default:
            return "Ìbáwọlé aṣìṣe";
        }
      };
    };
    function default_1() {
      return {
        localeError: error()
      };
    }
    module2.exports = exports2.default;
  })(yo$1, yo$1.exports);
  return yo$1.exports;
}
var hasRequiredLocales;
function requireLocales() {
  if (hasRequiredLocales) return locales;
  hasRequiredLocales = 1;
  (function(exports2) {
    var __importDefault = locales && locales.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.sv = exports2.sl = exports2.sk = exports2.ru = exports2.ro = exports2.ptBR = exports2.pt = exports2.pl = exports2.ps = exports2.ota = exports2.no = exports2.nn = exports2.nl = exports2.ne = exports2.ms = exports2.mk = exports2.lt = exports2.ko = exports2.kn = exports2.km = exports2.kh = exports2.ka = exports2.ja = exports2.it = exports2.is = exports2.id = exports2.hy = exports2.hu = exports2.hr = exports2.hi = exports2.he = exports2.gu = exports2.frCA = exports2.fr = exports2.fi = exports2.fa = exports2.es = exports2.eo = exports2.en = exports2.el = exports2.de = exports2.da = exports2.cs = exports2.ckb = exports2.ca = exports2.bn = exports2.bg = exports2.be = exports2.az = exports2.ar = void 0;
    exports2.yo = exports2.zhTW = exports2.zhCN = exports2.vi = exports2.uz = exports2.ur = exports2.uk = exports2.ua = exports2.tr = exports2.tk = exports2.th = exports2.tg = exports2.ta = void 0;
    var ar_js_1 = /* @__PURE__ */ requireAr();
    Object.defineProperty(exports2, "ar", { enumerable: true, get: function() {
      return __importDefault(ar_js_1).default;
    } });
    var az_js_1 = /* @__PURE__ */ requireAz();
    Object.defineProperty(exports2, "az", { enumerable: true, get: function() {
      return __importDefault(az_js_1).default;
    } });
    var be_js_1 = /* @__PURE__ */ requireBe();
    Object.defineProperty(exports2, "be", { enumerable: true, get: function() {
      return __importDefault(be_js_1).default;
    } });
    var bg_js_1 = /* @__PURE__ */ requireBg();
    Object.defineProperty(exports2, "bg", { enumerable: true, get: function() {
      return __importDefault(bg_js_1).default;
    } });
    var bn_js_1 = /* @__PURE__ */ requireBn();
    Object.defineProperty(exports2, "bn", { enumerable: true, get: function() {
      return __importDefault(bn_js_1).default;
    } });
    var ca_js_1 = /* @__PURE__ */ requireCa();
    Object.defineProperty(exports2, "ca", { enumerable: true, get: function() {
      return __importDefault(ca_js_1).default;
    } });
    var ckb_js_1 = /* @__PURE__ */ requireCkb();
    Object.defineProperty(exports2, "ckb", { enumerable: true, get: function() {
      return __importDefault(ckb_js_1).default;
    } });
    var cs_js_1 = /* @__PURE__ */ requireCs();
    Object.defineProperty(exports2, "cs", { enumerable: true, get: function() {
      return __importDefault(cs_js_1).default;
    } });
    var da_js_1 = /* @__PURE__ */ requireDa();
    Object.defineProperty(exports2, "da", { enumerable: true, get: function() {
      return __importDefault(da_js_1).default;
    } });
    var de_js_1 = /* @__PURE__ */ requireDe();
    Object.defineProperty(exports2, "de", { enumerable: true, get: function() {
      return __importDefault(de_js_1).default;
    } });
    var el_js_1 = /* @__PURE__ */ requireEl();
    Object.defineProperty(exports2, "el", { enumerable: true, get: function() {
      return __importDefault(el_js_1).default;
    } });
    var en_js_1 = /* @__PURE__ */ requireEn();
    Object.defineProperty(exports2, "en", { enumerable: true, get: function() {
      return __importDefault(en_js_1).default;
    } });
    var eo_js_1 = /* @__PURE__ */ requireEo();
    Object.defineProperty(exports2, "eo", { enumerable: true, get: function() {
      return __importDefault(eo_js_1).default;
    } });
    var es_js_1 = /* @__PURE__ */ requireEs();
    Object.defineProperty(exports2, "es", { enumerable: true, get: function() {
      return __importDefault(es_js_1).default;
    } });
    var fa_js_1 = /* @__PURE__ */ requireFa();
    Object.defineProperty(exports2, "fa", { enumerable: true, get: function() {
      return __importDefault(fa_js_1).default;
    } });
    var fi_js_1 = /* @__PURE__ */ requireFi();
    Object.defineProperty(exports2, "fi", { enumerable: true, get: function() {
      return __importDefault(fi_js_1).default;
    } });
    var fr_js_1 = /* @__PURE__ */ requireFr();
    Object.defineProperty(exports2, "fr", { enumerable: true, get: function() {
      return __importDefault(fr_js_1).default;
    } });
    var fr_CA_js_1 = /* @__PURE__ */ requireFrCA();
    Object.defineProperty(exports2, "frCA", { enumerable: true, get: function() {
      return __importDefault(fr_CA_js_1).default;
    } });
    var gu_js_1 = /* @__PURE__ */ requireGu();
    Object.defineProperty(exports2, "gu", { enumerable: true, get: function() {
      return __importDefault(gu_js_1).default;
    } });
    var he_js_1 = /* @__PURE__ */ requireHe();
    Object.defineProperty(exports2, "he", { enumerable: true, get: function() {
      return __importDefault(he_js_1).default;
    } });
    var hi_js_1 = /* @__PURE__ */ requireHi();
    Object.defineProperty(exports2, "hi", { enumerable: true, get: function() {
      return __importDefault(hi_js_1).default;
    } });
    var hr_js_1 = /* @__PURE__ */ requireHr();
    Object.defineProperty(exports2, "hr", { enumerable: true, get: function() {
      return __importDefault(hr_js_1).default;
    } });
    var hu_js_1 = /* @__PURE__ */ requireHu();
    Object.defineProperty(exports2, "hu", { enumerable: true, get: function() {
      return __importDefault(hu_js_1).default;
    } });
    var hy_js_1 = /* @__PURE__ */ requireHy();
    Object.defineProperty(exports2, "hy", { enumerable: true, get: function() {
      return __importDefault(hy_js_1).default;
    } });
    var id_js_1 = /* @__PURE__ */ requireId();
    Object.defineProperty(exports2, "id", { enumerable: true, get: function() {
      return __importDefault(id_js_1).default;
    } });
    var is_js_1 = /* @__PURE__ */ requireIs();
    Object.defineProperty(exports2, "is", { enumerable: true, get: function() {
      return __importDefault(is_js_1).default;
    } });
    var it_js_1 = /* @__PURE__ */ requireIt();
    Object.defineProperty(exports2, "it", { enumerable: true, get: function() {
      return __importDefault(it_js_1).default;
    } });
    var ja_js_1 = /* @__PURE__ */ requireJa();
    Object.defineProperty(exports2, "ja", { enumerable: true, get: function() {
      return __importDefault(ja_js_1).default;
    } });
    var ka_js_1 = /* @__PURE__ */ requireKa();
    Object.defineProperty(exports2, "ka", { enumerable: true, get: function() {
      return __importDefault(ka_js_1).default;
    } });
    var kh_js_1 = /* @__PURE__ */ requireKh();
    Object.defineProperty(exports2, "kh", { enumerable: true, get: function() {
      return __importDefault(kh_js_1).default;
    } });
    var km_js_1 = /* @__PURE__ */ requireKm();
    Object.defineProperty(exports2, "km", { enumerable: true, get: function() {
      return __importDefault(km_js_1).default;
    } });
    var kn_js_1 = /* @__PURE__ */ requireKn();
    Object.defineProperty(exports2, "kn", { enumerable: true, get: function() {
      return __importDefault(kn_js_1).default;
    } });
    var ko_js_1 = /* @__PURE__ */ requireKo();
    Object.defineProperty(exports2, "ko", { enumerable: true, get: function() {
      return __importDefault(ko_js_1).default;
    } });
    var lt_js_1 = /* @__PURE__ */ requireLt();
    Object.defineProperty(exports2, "lt", { enumerable: true, get: function() {
      return __importDefault(lt_js_1).default;
    } });
    var mk_js_1 = /* @__PURE__ */ requireMk();
    Object.defineProperty(exports2, "mk", { enumerable: true, get: function() {
      return __importDefault(mk_js_1).default;
    } });
    var ms_js_1 = /* @__PURE__ */ requireMs();
    Object.defineProperty(exports2, "ms", { enumerable: true, get: function() {
      return __importDefault(ms_js_1).default;
    } });
    var ne_js_1 = /* @__PURE__ */ requireNe();
    Object.defineProperty(exports2, "ne", { enumerable: true, get: function() {
      return __importDefault(ne_js_1).default;
    } });
    var nl_js_1 = /* @__PURE__ */ requireNl();
    Object.defineProperty(exports2, "nl", { enumerable: true, get: function() {
      return __importDefault(nl_js_1).default;
    } });
    var nn_js_1 = /* @__PURE__ */ requireNn();
    Object.defineProperty(exports2, "nn", { enumerable: true, get: function() {
      return __importDefault(nn_js_1).default;
    } });
    var no_js_1 = /* @__PURE__ */ requireNo();
    Object.defineProperty(exports2, "no", { enumerable: true, get: function() {
      return __importDefault(no_js_1).default;
    } });
    var ota_js_1 = /* @__PURE__ */ requireOta();
    Object.defineProperty(exports2, "ota", { enumerable: true, get: function() {
      return __importDefault(ota_js_1).default;
    } });
    var ps_js_1 = /* @__PURE__ */ requirePs();
    Object.defineProperty(exports2, "ps", { enumerable: true, get: function() {
      return __importDefault(ps_js_1).default;
    } });
    var pl_js_1 = /* @__PURE__ */ requirePl();
    Object.defineProperty(exports2, "pl", { enumerable: true, get: function() {
      return __importDefault(pl_js_1).default;
    } });
    var pt_js_1 = /* @__PURE__ */ requirePt();
    Object.defineProperty(exports2, "pt", { enumerable: true, get: function() {
      return __importDefault(pt_js_1).default;
    } });
    var pt_BR_js_1 = /* @__PURE__ */ requirePtBR();
    Object.defineProperty(exports2, "ptBR", { enumerable: true, get: function() {
      return __importDefault(pt_BR_js_1).default;
    } });
    var ro_js_1 = /* @__PURE__ */ requireRo();
    Object.defineProperty(exports2, "ro", { enumerable: true, get: function() {
      return __importDefault(ro_js_1).default;
    } });
    var ru_js_1 = /* @__PURE__ */ requireRu();
    Object.defineProperty(exports2, "ru", { enumerable: true, get: function() {
      return __importDefault(ru_js_1).default;
    } });
    var sk_js_1 = /* @__PURE__ */ requireSk();
    Object.defineProperty(exports2, "sk", { enumerable: true, get: function() {
      return __importDefault(sk_js_1).default;
    } });
    var sl_js_1 = /* @__PURE__ */ requireSl();
    Object.defineProperty(exports2, "sl", { enumerable: true, get: function() {
      return __importDefault(sl_js_1).default;
    } });
    var sv_js_1 = /* @__PURE__ */ requireSv();
    Object.defineProperty(exports2, "sv", { enumerable: true, get: function() {
      return __importDefault(sv_js_1).default;
    } });
    var ta_js_1 = /* @__PURE__ */ requireTa();
    Object.defineProperty(exports2, "ta", { enumerable: true, get: function() {
      return __importDefault(ta_js_1).default;
    } });
    var tg_js_1 = /* @__PURE__ */ requireTg();
    Object.defineProperty(exports2, "tg", { enumerable: true, get: function() {
      return __importDefault(tg_js_1).default;
    } });
    var th_js_1 = /* @__PURE__ */ requireTh();
    Object.defineProperty(exports2, "th", { enumerable: true, get: function() {
      return __importDefault(th_js_1).default;
    } });
    var tk_js_1 = /* @__PURE__ */ requireTk();
    Object.defineProperty(exports2, "tk", { enumerable: true, get: function() {
      return __importDefault(tk_js_1).default;
    } });
    var tr_js_1 = /* @__PURE__ */ requireTr();
    Object.defineProperty(exports2, "tr", { enumerable: true, get: function() {
      return __importDefault(tr_js_1).default;
    } });
    var ua_js_1 = /* @__PURE__ */ requireUa();
    Object.defineProperty(exports2, "ua", { enumerable: true, get: function() {
      return __importDefault(ua_js_1).default;
    } });
    var uk_js_1 = /* @__PURE__ */ requireUk();
    Object.defineProperty(exports2, "uk", { enumerable: true, get: function() {
      return __importDefault(uk_js_1).default;
    } });
    var ur_js_1 = /* @__PURE__ */ requireUr();
    Object.defineProperty(exports2, "ur", { enumerable: true, get: function() {
      return __importDefault(ur_js_1).default;
    } });
    var uz_js_1 = /* @__PURE__ */ requireUz();
    Object.defineProperty(exports2, "uz", { enumerable: true, get: function() {
      return __importDefault(uz_js_1).default;
    } });
    var vi_js_1 = /* @__PURE__ */ requireVi();
    Object.defineProperty(exports2, "vi", { enumerable: true, get: function() {
      return __importDefault(vi_js_1).default;
    } });
    var zh_CN_js_1 = /* @__PURE__ */ requireZhCN();
    Object.defineProperty(exports2, "zhCN", { enumerable: true, get: function() {
      return __importDefault(zh_CN_js_1).default;
    } });
    var zh_TW_js_1 = /* @__PURE__ */ requireZhTW();
    Object.defineProperty(exports2, "zhTW", { enumerable: true, get: function() {
      return __importDefault(zh_TW_js_1).default;
    } });
    var yo_js_1 = /* @__PURE__ */ requireYo();
    Object.defineProperty(exports2, "yo", { enumerable: true, get: function() {
      return __importDefault(yo_js_1).default;
    } });
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(locales);
  return locales;
}
var registries = {};
var hasRequiredRegistries;
function requireRegistries() {
  if (hasRequiredRegistries) return registries;
  hasRequiredRegistries = 1;
  (function(exports2) {
    var _a;
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.globalRegistry = exports2.$ZodRegistry = exports2.$input = exports2.$output = void 0;
    exports2.registry = registry;
    exports2.$output = Symbol("ZodOutput");
    exports2.$input = Symbol("ZodInput");
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
    exports2.$ZodRegistry = $ZodRegistry;
    function registry() {
      return new $ZodRegistry();
    }
    (_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
    exports2.globalRegistry = globalThis.__zod_globalRegistry;
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(registries);
  return registries;
}
var compile = {};
var hasRequiredCompile;
function requireCompile() {
  if (hasRequiredCompile) return compile;
  hasRequiredCompile = 1;
  (function(exports2) {
    var __createBinding = compile && compile.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = compile && compile.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = compile && compile.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ZodCompileUnsupportedError = exports2.ZodCompileAsyncError = exports2.INVALID = void 0;
    exports2.compile = compile$1;
    exports2.withParser = withParser;
    exports2.compileFn = compileFn;
    const core_js_1 = /* @__PURE__ */ requireCore$1();
    const doc_js_1 = /* @__PURE__ */ requireDoc();
    const memoizer_js_1 = /* @__PURE__ */ requireMemoizer();
    const regexes2 = __importStar(/* @__PURE__ */ requireRegexes());
    const schemas_js_1 = /* @__PURE__ */ requireSchemas$1();
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    exports2.INVALID = Symbol.for("zod.compile.invalid");
    const FALLBACK_FLAG = Symbol.for("zod.compile.fallback");
    class ZodCompileAsyncError extends Error {
      constructor(message = "z.compile does not support async refinements, transforms, or checks") {
        super(message);
        this.name = "ZodCompileAsyncError";
      }
    }
    exports2.ZodCompileAsyncError = ZodCompileAsyncError;
    class ZodCompileUnsupportedError extends Error {
      constructor(feature, islandable = true) {
        super(`z.compile does not support ${feature}; this schema must use the runtime parser`);
        this.name = "ZodCompileUnsupportedError";
        this.islandable = islandable;
      }
    }
    exports2.ZodCompileUnsupportedError = ZodCompileUnsupportedError;
    function compileValidator(schema, parser) {
      try {
        return compileFn(schema, { assertOnly: true });
      } catch {
        return parser;
      }
    }
    function compile$1(schema, options) {
      try {
        const parser = compileFn(schema);
        const clone = withParser(schema, parser);
        clone._zod.bag.validator = compileValidator(schema, parser);
        return clone;
      } catch (err) {
        if (options?.strict)
          throw err;
        return schema;
      }
    }
    function withParser(schema, parser) {
      if ((0, memoizer_js_1.isRecursiveSchema)(schema)) {
        throw new ZodCompileUnsupportedError("a schema whose subtree contains a reference cycle");
      }
      const clone = util2.clone(schema);
      const liveRun = schema._zod.run;
      const originalRun = liveRun.__originalRun ?? liveRun;
      const wrapped = (payload, ctx) => {
        if (ctx?.async || ctx?.direction === "backward" || ctx?.skipChecks || ctx?.[FALLBACK_FLAG]) {
          return originalRun(payload, ctx);
        }
        if (ctx && (0, memoizer_js_1.isBackEdge)(ctx, payload.value)) {
          return originalRun(payload, ctx);
        }
        const out = parser(payload.value);
        if (out !== exports2.INVALID) {
          payload.value = out;
          return payload;
        }
        if (ctx)
          ctx[FALLBACK_FLAG] = true;
        return originalRun(payload, ctx);
      };
      wrapped.__originalRun = originalRun;
      clone._zod.bag.fallbackRun = originalRun;
      clone._zod.bag.validator = parser;
      clone._zod.run = wrapped;
      if (!liveRun.__originalRun)
        installCompiledUserMethods(clone, schema, parser);
      return clone;
    }
    function installCompiledUserMethods(target, source, parser) {
      const targetAny = target;
      const sourceAny = source;
      if (typeof sourceAny.safeParse === "function") {
        const originalSafeParse = sourceAny.safeParse;
        targetAny.safeParse = (data2, params) => {
          const out = parser(data2);
          if (out !== exports2.INVALID) {
            return { success: true, data: out };
          }
          return originalSafeParse(data2, params);
        };
      }
      if (typeof sourceAny.parse === "function") {
        const originalParse = sourceAny.parse;
        targetAny.parse = (data2, params) => {
          const out = parser(data2);
          if (out !== exports2.INVALID) {
            return out;
          }
          return originalParse(data2, params);
        };
      }
    }
    function compileFn(schema, options) {
      let recursive = true;
      try {
        recursive = (0, memoizer_js_1.isRecursiveSchema)(schema);
      } catch {
      }
      if (recursive) {
        throw new ZodCompileUnsupportedError("a schema whose subtree contains a reference cycle");
      }
      const ctx = {
        constants: /* @__PURE__ */ new Map(),
        constantCounter: 0,
        varCounter: 0,
        definite: true
      };
      const doc2 = new doc_js_1.Doc(["input"]);
      const outputAccessor = generateCheck(doc2, ctx, schema, "input", !options?.assertOnly);
      doc2.write(outputAccessor === null ? `return true;` : `return ${outputAccessor};`);
      const constantNames = ["INVALID", ...ctx.constants.keys()];
      const constantValues = [exports2.INVALID, ...ctx.constants.values()];
      const code = doc2.content.join("\n");
      const fullCode = options?.debug ? constantNames.length > 0 ? `// Constants: ${constantNames.join(", ")}
${code}` : code : "";
      const F = Function;
      const factoryCode = `return (input) => {
${code}
}`;
      let fn;
      try {
        const factory = new F(...constantNames, factoryCode);
        fn = factory(...constantValues);
      } catch (err) {
        throw new ZodCompileUnsupportedError(`this schema (generated code failed to evaluate: ${err.message})`);
      }
      if (options?.debug) {
        fn.code = fullCode;
      }
      fn.definite = ctx.definite;
      return fn;
    }
    function addConstant(ctx, value) {
      for (const [name2, v] of ctx.constants) {
        if (v === value)
          return name2;
      }
      const name = `c${ctx.constantCounter++}`;
      ctx.constants.set(name, value);
      return name;
    }
    function addUserConstant(ctx, fn) {
      ctx.definite = false;
      return addConstant(ctx, fn);
    }
    function newVar(ctx) {
      return `v${ctx.varCounter++}`;
    }
    function runtimeRun(schema, value) {
      const result = schema._zod.run({ value, issues: [] }, {});
      if (result && typeof result.then === "function")
        return exports2.INVALID;
      const r = result;
      return r.issues.length === 0 ? r.value : exports2.INVALID;
    }
    function compileChild(doc2, ctx, schema, accessor, needsValue = true) {
      const contentLen = doc2.content.length;
      const constantCount = ctx.constants.size;
      const constantCounter = ctx.constantCounter;
      const varCounter = ctx.varCounter;
      try {
        return generateCheck(doc2, ctx, schema, accessor, needsValue);
      } catch (err) {
        if (!(err instanceof ZodCompileUnsupportedError) || !err.islandable)
          throw err;
        doc2.content.length = contentLen;
        if (ctx.constants.size > constantCount) {
          const trailing = Array.from(ctx.constants.keys()).slice(constantCount);
          for (const k of trailing)
            ctx.constants.delete(k);
        }
        ctx.constantCounter = constantCounter;
        ctx.varCounter = varCounter;
        return emitRuntimeIsland(doc2, ctx, schema, accessor);
      }
    }
    function emitRuntimeIsland(doc2, ctx, schema, accessor) {
      ctx.definite = false;
      const schemaConst = addConstant(ctx, schema);
      const runConst = addConstant(ctx, runtimeRun);
      const outVar = newVar(ctx);
      doc2.write(`const ${outVar} = ${runConst}(${schemaConst}, ${accessor});`);
      doc2.write(`if (${outVar} === INVALID) return INVALID;`);
      return outVar;
    }
    const WHEN_DEFAULTED_CHECKS = /* @__PURE__ */ new Set([
      "max_size",
      "min_size",
      "size_equals",
      "max_length",
      "min_length",
      "length_equals"
    ]);
    function generateChecks(doc2, ctx, schema, accessor) {
      const schemaChecks = schema._zod.def.checks;
      if (!schemaChecks || schemaChecks.length === 0)
        return accessor;
      let currentAccessor = accessor;
      for (const check of schemaChecks) {
        const def = check._zod.def;
        if (def.when && !WHEN_DEFAULTED_CHECKS.has(def.check)) {
          throw new ZodCompileUnsupportedError(`check with a custom "when" condition`);
        }
        switch (def.check) {
          case "greater_than":
            generateGreaterThanCheck(doc2, ctx, def, currentAccessor);
            break;
          case "less_than":
            generateLessThanCheck(doc2, ctx, def, currentAccessor);
            break;
          case "multiple_of":
            generateMultipleOfCheck(doc2, ctx, def, currentAccessor);
            break;
          case "number_format":
            generateNumberFormatCheck(doc2, def, currentAccessor);
            break;
          case "min_length": {
            const min = numericOperand(def.minimum, "min_length");
            const len = codePointLengthVar(doc2, ctx, currentAccessor, `${currentAccessor}.length >= ${min} && ${currentAccessor}.length < ${def.minimum * 2}`);
            doc2.write(`if (${len} < ${min}) return INVALID;`);
            break;
          }
          case "max_length": {
            const max = numericOperand(def.maximum, "max_length");
            const len = codePointLengthVar(doc2, ctx, currentAccessor, `${currentAccessor}.length > ${max}`);
            doc2.write(`if (${len} > ${max}) return INVALID;`);
            break;
          }
          case "length_equals": {
            const exact = numericOperand(def.length, "length_equals");
            const len = codePointLengthVar(doc2, ctx, currentAccessor, `${currentAccessor}.length >= ${exact} && ${currentAccessor}.length <= ${def.length * 2}`);
            doc2.write(`if (${len} !== ${exact}) return INVALID;`);
            break;
          }
          case "min_size":
            doc2.write(`if (${currentAccessor}.size < ${numericOperand(def.minimum, "min_size")}) return INVALID;`);
            break;
          case "max_size":
            doc2.write(`if (${currentAccessor}.size > ${numericOperand(def.maximum, "max_size")}) return INVALID;`);
            break;
          case "size_equals":
            doc2.write(`if (${currentAccessor}.size !== ${numericOperand(def.size, "size_equals")}) return INVALID;`);
            break;
          case "string_format":
            currentAccessor = generateStringFormatCheck(doc2, ctx, def, currentAccessor);
            break;
          case "custom":
            currentAccessor = generateCustomRefineCheck(doc2, ctx, check, currentAccessor);
            break;
          case "bigint_format":
            generateBigIntFormatCheck(doc2, def, currentAccessor);
            break;
          case "mime_type":
            generateMimeTypeCheck(doc2, ctx, def, currentAccessor);
            break;
          case "property":
            generatePropertyCheck(doc2, ctx, def, currentAccessor);
            break;
          case "properties":
            generatePropertiesChecks(doc2, ctx, def, currentAccessor);
            break;
          case "overwrite": {
            const newAccessor = newVar(ctx);
            generateOverwriteCheck(doc2, ctx, check, currentAccessor, newAccessor);
            currentAccessor = newAccessor;
            break;
          }
          default: {
            throw new ZodCompileUnsupportedError(`check type ${def.check}`);
          }
        }
      }
      return currentAccessor;
    }
    function codePointLengthVar(doc2, ctx, accessor, inDoubt) {
      const cpLen = addConstant(ctx, util2.codePointLength);
      const v = newVar(ctx);
      doc2.write(`const ${v} = typeof ${accessor} === "string" && ${inDoubt} ? ${cpLen}(${accessor}) : ${accessor}.length;`);
      return v;
    }
    function numericOperand(value, label) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ZodCompileUnsupportedError(`${label} bound of type ${typeof value}`);
      }
      return `${value}`;
    }
    function comparisonOperand(ctx, value) {
      if (typeof value === "bigint")
        return `${value}n`;
      if (typeof value === "number") {
        if (Number.isNaN(value))
          throw new ZodCompileUnsupportedError("comparison check with NaN bound");
        return `${value}`;
      }
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
          throw new ZodCompileUnsupportedError("comparison check with Invalid Date bound");
        }
        return addConstant(ctx, value);
      }
      throw new ZodCompileUnsupportedError(`comparison check bound of type ${typeof value}`);
    }
    function generateGreaterThanCheck(doc2, ctx, def, accessor) {
      const op = def.inclusive ? "<" : "<=";
      doc2.write(`if (${accessor} ${op} ${comparisonOperand(ctx, def.value)}) return INVALID;`);
    }
    function generateLessThanCheck(doc2, ctx, def, accessor) {
      const op = def.inclusive ? ">" : ">=";
      doc2.write(`if (${accessor} ${op} ${comparisonOperand(ctx, def.value)}) return INVALID;`);
    }
    function generateMultipleOfCheck(doc2, ctx, def, accessor) {
      if (typeof def.value === "bigint") {
        if (def.value === BigInt(0))
          throw new ZodCompileUnsupportedError("multiple_of check with a zero divisor");
        doc2.write(`if (${accessor} % ${def.value}n !== 0n) return INVALID;`);
      } else {
        const remainder = addConstant(ctx, util2.floatSafeRemainder);
        doc2.write(`if (${remainder}(${accessor}, ${numericOperand(def.value, "multiple_of")}) !== 0) return INVALID;`);
      }
    }
    function generateNumberFormatCheck(doc2, def, accessor) {
      const format = def.format;
      switch (format) {
        case "safeint":
          doc2.write(`if (!Number.isSafeInteger(${accessor})) return INVALID;`);
          break;
        case "int32":
          doc2.write(`if (!Number.isInteger(${accessor}) || ${accessor} < -2147483648 || ${accessor} > 2147483647) return INVALID;`);
          break;
        case "uint32":
          doc2.write(`if (!Number.isInteger(${accessor}) || ${accessor} < 0 || ${accessor} > 4294967295) return INVALID;`);
          break;
        case "float32":
          doc2.write(`if (!Number.isFinite(${accessor}) || ${accessor} < -3.4028234663852886e38 || ${accessor} > 3.4028234663852886e38) return INVALID;`);
          break;
        case "float64":
          doc2.write(`if (!Number.isFinite(${accessor})) return INVALID;`);
          break;
        default: {
          throw new ZodCompileUnsupportedError(`number format ${format}`);
        }
      }
    }
    function generateBigIntFormatCheck(doc2, def, accessor) {
      const format = def.format;
      if (!format)
        return;
      switch (format) {
        case "int64":
          doc2.write(`if (${accessor} < -9223372036854775808n || ${accessor} > 9223372036854775807n) return INVALID;`);
          break;
        case "uint64":
          doc2.write(`if (${accessor} < 0n || ${accessor} > 18446744073709551615n) return INVALID;`);
          break;
        default: {
          throw new ZodCompileUnsupportedError(`bigint format ${format}`);
        }
      }
    }
    function generateMimeTypeCheck(doc2, ctx, def, accessor) {
      const mimeTypes = def.mime;
      if (mimeTypes && mimeTypes.length > 0) {
        const mimeSet = addConstant(ctx, new Set(mimeTypes));
        doc2.write(`if (!${mimeSet}.has(${accessor}.type)) return INVALID;`);
      }
    }
    function generatePropertiesChecks(doc2, ctx, def, accessor) {
      if (def.when) {
        throw new ZodCompileUnsupportedError(`check with a custom "when" condition`);
      }
      doc2.write(`if (${accessor} == null) return INVALID;`);
      const shape = def.shape;
      for (const key of Reflect.ownKeys(shape)) {
        const keyExpr = typeof key === "symbol" ? addConstant(ctx, key) : util2.esc(key);
        const inputVar = newVar(ctx);
        doc2.write(`const ${inputVar} = ${accessor}[${keyExpr}];`);
        compileChild(doc2, ctx, shape[key], inputVar, false);
      }
    }
    function generatePropertyCheck(doc2, ctx, def, accessor) {
      const propAccessor = `${accessor}[${JSON.stringify(def.property)}]`;
      generateCheck(doc2, ctx, def.schema, propAccessor);
    }
    function generateOverwriteCheck(doc2, ctx, check, currentAccessor, newAccessor) {
      const tx = check._zod.def.tx;
      if (!tx) {
        throw new ZodCompileUnsupportedError("overwrite check without a transform function");
      }
      if (isAsyncFunction(tx)) {
        throw new ZodCompileAsyncError("z.compile: async overwrite transforms are not supported");
      }
      const txConst = addConstant(ctx, tx);
      doc2.write(`const ${newAccessor} = ${txConst}(${currentAccessor});`);
    }
    function throwAsync() {
      throw new core_js_1.$ZodAsyncError();
    }
    function pushIssue(issue) {
      this.issues.push(issue);
    }
    function generateCustomRefineCheck(doc2, ctx, check, accessor) {
      const def = check._zod.def;
      if (def.fn) {
        if (isAsyncFunction(def.fn)) {
          throw new ZodCompileAsyncError("z.compile: async .refine() predicates are not supported");
        }
        const fnConst = addUserConstant(ctx, def.fn);
        const throwAsyncConst = addConstant(ctx, throwAsync);
        const resVar = newVar(ctx);
        doc2.write(`const ${resVar} = ${fnConst}(${accessor});`);
        doc2.write(`if (${resVar} instanceof Promise) ${throwAsyncConst}();`);
        doc2.write(`if (!${resVar}) return INVALID;`);
        return accessor;
      }
      if (check._zod.check) {
        if (isAsyncFunction(check._zod.check)) {
          throw new ZodCompileAsyncError("z.compile: async .superRefine() / check functions are not supported");
        }
        const checkFn = check._zod.check;
        const helperFn = (value) => {
          const fakePayload = { value, issues: [], addIssue: pushIssue };
          const result = checkFn(fakePayload);
          if (result instanceof Promise)
            throwAsync();
          return fakePayload.issues.length === 0 ? fakePayload.value : exports2.INVALID;
        };
        const helperConst = addUserConstant(ctx, helperFn);
        const outVar = newVar(ctx);
        doc2.write(`const ${outVar} = ${helperConst}(${accessor});`);
        doc2.write(`if (${outVar} === INVALID) return INVALID;`);
        return outVar;
      }
      throw new ZodCompileUnsupportedError("custom check without a predicate or check function");
    }
    const PATTERN_IS_COMPLETE = /* @__PURE__ */ new Set([
      "cidrv4",
      "cuid",
      "cuid2",
      "date",
      "datetime",
      "duration",
      "e164",
      "email",
      "emoji",
      "ends_with",
      "guid",
      "includes",
      "ipv4",
      "ksuid",
      "lowercase",
      "mac",
      "nanoid",
      "regex",
      "starts_with",
      "time",
      "ulid",
      "uppercase",
      "uuid",
      "xid"
    ]);
    function generateStringFormatCheck(doc2, ctx, def, accessor, needsValue = true) {
      const fmt = def.format;
      if (fmt === "base64") {
        const validator = addConstant(ctx, schemas_js_1.isValidBase64);
        doc2.write(`if (!${validator}(${accessor})) return INVALID;`);
        return accessor;
      }
      if (fmt === "base64url") {
        const validator = addConstant(ctx, schemas_js_1.isValidBase64URL);
        doc2.write(`if (!${validator}(${accessor})) return INVALID;`);
        return accessor;
      }
      if (fmt === "jwt") {
        const validator = addConstant(ctx, schemas_js_1.isValidJWT);
        const alg = addConstant(ctx, def.alg ?? null);
        doc2.write(`if (!${validator}(${accessor}, ${alg})) return INVALID;`);
        return accessor;
      }
      if (fmt === "ipv6") {
        const validator = addConstant(ctx, schemas_js_1.isValidIPv6);
        doc2.write(`if (!${validator}(${accessor})) return INVALID;`);
        return accessor;
      }
      if (fmt === "cidrv6") {
        const validator = addConstant(ctx, schemas_js_1.isValidCIDRv6);
        doc2.write(`if (!${validator}(${accessor})) return INVALID;`);
        return accessor;
      }
      if (fmt === "credit_card") {
        const validator = addConstant(ctx, schemas_js_1.isValidCreditCard);
        doc2.write(`if (!${validator}(${accessor})) return INVALID;`);
        return accessor;
      }
      if (fmt === "iban") {
        const validator = addConstant(ctx, schemas_js_1.isValidIBAN);
        doc2.write(`if (!${validator}(${accessor})) return INVALID;`);
        return accessor;
      }
      const formatDef = def;
      if (fmt === "url" || fmt === "httpurl" || formatDef.normalize || formatDef.hostname !== void 0 || formatDef.protocol !== void 0) {
        const parseConst = addConstant(ctx, schemas_js_1.validateURL);
        const defConst = addConstant(ctx, def);
        const trimVar = newVar(ctx);
        const urlVar = newVar(ctx);
        doc2.write(`const ${trimVar} = ${accessor}.trim();`);
        doc2.write(`const ${urlVar} = ${parseConst}(${trimVar}, ${defConst});`);
        doc2.write(`if (typeof ${urlVar} === "number") return INVALID;`);
        if (formatDef.hostname !== void 0) {
          const hostnameConst = addConstant(ctx, schemas_js_1.urlHostnameOk);
          doc2.write(`if (!${hostnameConst}(${urlVar}, ${defConst}.hostname)) return INVALID;`);
        }
        if (formatDef.protocol !== void 0) {
          const protocolConst = addConstant(ctx, schemas_js_1.urlProtocolOk);
          doc2.write(`if (!${protocolConst}(${urlVar}, ${defConst}.protocol)) return INVALID;`);
        }
        if (!needsValue)
          return null;
        const outputVar = newVar(ctx);
        const outputExpr = formatDef.normalize ? `${urlVar}.href` : `${addConstant(ctx, schemas_js_1.stripTabAndNewline)}(${trimVar})`;
        doc2.write(`const ${outputVar} = ${outputExpr};`);
        return outputVar;
      }
      const customFn = def.fn;
      if (customFn) {
        if (isAsyncFunction(customFn))
          throw new ZodCompileUnsupportedError(`async string format ${fmt}`);
        const fnConst = addConstant(ctx, customFn);
        doc2.write(`if (!${fnConst}(${accessor})) return INVALID;`);
        return accessor;
      }
      if (PATTERN_IS_COMPLETE.has(fmt) && def.pattern) {
        const patternConst = addConstant(ctx, def.pattern);
        doc2.write(`${patternConst}.lastIndex = 0;`);
        doc2.write(`if (!${patternConst}.test(${accessor})) return INVALID;`);
        return accessor;
      }
      const format = def.format;
      switch (format) {
        case "regex":
          throw new ZodCompileUnsupportedError("regex format without a pattern");
        case "lowercase":
          doc2.write(`if (${accessor} !== ${accessor}.toLowerCase()) return INVALID;`);
          break;
        case "uppercase":
          doc2.write(`if (${accessor} !== ${accessor}.toUpperCase()) return INVALID;`);
          break;
        case "includes":
          doc2.write(`if (!${accessor}.includes(${util2.esc(def.includes)})) return INVALID;`);
          break;
        case "starts_with": {
          const prefix = def.prefix;
          doc2.write(`if (${accessor}.slice(0, ${prefix.length}) !== ${util2.esc(prefix)}) return INVALID;`);
          break;
        }
        case "ends_with": {
          const suffix = def.suffix;
          doc2.write(`if (${accessor}.slice(-${suffix.length}) !== ${util2.esc(suffix)}) return INVALID;`);
          break;
        }
        default: {
          throw new ZodCompileUnsupportedError(`string format ${format}`);
        }
      }
      return accessor;
    }
    function generateCheck(doc2, ctx, schema, accessor, needsValue = true) {
      const def = schema._zod.def;
      const type = def.type;
      if (def.coerce) {
        throw new ZodCompileUnsupportedError(`coercion (z.coerce.${type}())`);
      }
      const buildsValue = needsValue || !!def.checks?.length;
      let typeAccessor;
      switch (type) {
        case "string":
          typeAccessor = generateStringCheck(doc2, ctx, schema, accessor, buildsValue);
          break;
        case "number":
          typeAccessor = generateNumberCheck(doc2, schema, accessor);
          break;
        case "boolean":
          typeAccessor = generateBooleanCheck(doc2, accessor);
          break;
        case "bigint":
          typeAccessor = generateBigIntCheck(doc2, schema, accessor);
          break;
        case "symbol":
          typeAccessor = generateSymbolCheck(doc2, accessor);
          break;
        case "undefined":
          typeAccessor = generateUndefinedCheck(doc2, accessor);
          break;
        case "null":
          typeAccessor = generateNullCheck(doc2, accessor);
          break;
        case "any":
        case "unknown":
          typeAccessor = accessor;
          break;
        case "never":
          doc2.write("return INVALID;");
          typeAccessor = accessor;
          break;
        case "void":
          typeAccessor = generateVoidCheck(doc2, accessor);
          break;
        case "nan":
          typeAccessor = generateNaNCheck(doc2, accessor);
          break;
        case "date":
          typeAccessor = generateDateCheck(doc2, accessor);
          break;
        case "object":
          typeAccessor = generateObjectCheck(doc2, ctx, schema, accessor, buildsValue);
          break;
        case "optional":
          typeAccessor = generateOptionalCheck(doc2, ctx, schema, accessor, buildsValue);
          break;
        case "nullable":
          typeAccessor = generateNullableCheck(doc2, ctx, schema, accessor, buildsValue);
          break;
        case "array":
          typeAccessor = generateArrayCheck(doc2, ctx, schema, accessor, buildsValue);
          break;
        case "literal":
          typeAccessor = generateLiteralCheck(doc2, ctx, schema, accessor);
          break;
        case "enum":
          typeAccessor = generateEnumCheck(doc2, ctx, schema, accessor);
          break;
        case "readonly": {
          const innerOut = generateWrapperCheck(doc2, ctx, schema, accessor);
          const frozenVar = newVar(ctx);
          doc2.write(`const ${frozenVar} = Object.freeze(${innerOut});`);
          typeAccessor = frozenVar;
          break;
        }
        case "success":
          generateWrapperCheck(doc2, ctx, schema, accessor);
          typeAccessor = "true";
          break;
        case "default":
        case "prefault":
          typeAccessor = generateDefaultCheck(doc2, ctx, schema, accessor);
          break;
        case "nonoptional":
          typeAccessor = generateNonOptionalCheck(doc2, ctx, schema, accessor);
          break;
        case "tuple":
          typeAccessor = generateTupleCheck(doc2, ctx, schema, accessor);
          break;
        case "union":
          typeAccessor = generateUnionCheck(doc2, ctx, schema, accessor);
          break;
        case "intersection":
          typeAccessor = generateIntersectionCheck(doc2, ctx, schema, accessor);
          break;
        case "record":
          typeAccessor = generateRecordCheck(doc2, ctx, schema, accessor);
          break;
        case "map":
          typeAccessor = generateMapCheck(doc2, ctx, schema, accessor);
          break;
        case "set":
          typeAccessor = generateSetCheck(doc2, ctx, schema, accessor);
          break;
        case "file":
          typeAccessor = generateFileCheck(doc2, accessor);
          break;
        case "template_literal":
          typeAccessor = generateTemplateLiteralCheck(doc2, ctx, schema, accessor);
          break;
        case "lazy":
          typeAccessor = generateLazyCheck(doc2, ctx, schema, accessor);
          break;
        case "pipe":
          typeAccessor = generatePipeCheck(doc2, ctx, schema, accessor);
          break;
        case "custom":
          typeAccessor = generateCustomCheck(doc2, ctx, schema, accessor);
          break;
        case "transform":
          typeAccessor = generateTransformCheck(doc2, ctx, schema, accessor);
          break;
        case "catch":
          typeAccessor = generateCatchCheck(doc2, ctx, schema, accessor);
          break;
        default: {
          throw new ZodCompileUnsupportedError(`schema type ${type}`);
        }
      }
      if (typeAccessor === null)
        return null;
      return generateChecks(doc2, ctx, schema, typeAccessor);
    }
    function generateStringCheck(doc2, ctx, schema, accessor, needsValue = true) {
      doc2.write(`if (typeof ${accessor} !== "string") return INVALID;`);
      const def = schema._zod.def;
      if (def.format === void 0)
        return accessor;
      return generateStringFormatCheck(doc2, ctx, def, accessor, needsValue);
    }
    function generateNumberCheck(doc2, schema, accessor) {
      doc2.write(`if (typeof ${accessor} !== "number" || !Number.isFinite(${accessor})) return INVALID;`);
      const def = schema._zod.def;
      if (def.check === "number_format" && def.format) {
        generateNumberFormatCheck(doc2, { format: def.format }, accessor);
      }
      return accessor;
    }
    function generateBooleanCheck(doc2, accessor) {
      doc2.write(`if (typeof ${accessor} !== "boolean") return INVALID;`);
      return accessor;
    }
    function generateBigIntCheck(doc2, schema, accessor) {
      doc2.write(`if (typeof ${accessor} !== "bigint") return INVALID;`);
      const def = schema._zod.def;
      if (def.format) {
        switch (def.format) {
          case "int64":
            doc2.write(`if (${accessor} < -9223372036854775808n || ${accessor} > 9223372036854775807n) return INVALID;`);
            break;
          case "uint64":
            doc2.write(`if (${accessor} < 0n || ${accessor} > 18446744073709551615n) return INVALID;`);
            break;
        }
      }
      return accessor;
    }
    function generateSymbolCheck(doc2, accessor) {
      doc2.write(`if (typeof ${accessor} !== "symbol") return INVALID;`);
      return accessor;
    }
    function generateUndefinedCheck(doc2, accessor) {
      doc2.write(`if (${accessor} !== undefined) return INVALID;`);
      return accessor;
    }
    function generateNullCheck(doc2, accessor) {
      doc2.write(`if (${accessor} !== null) return INVALID;`);
      return accessor;
    }
    function generateVoidCheck(doc2, accessor) {
      doc2.write(`if (${accessor} !== undefined) return INVALID;`);
      return accessor;
    }
    function generateNaNCheck(doc2, accessor) {
      doc2.write(`if (typeof ${accessor} !== "number" || !Number.isNaN(${accessor})) return INVALID;`);
      return accessor;
    }
    function generateDateCheck(doc2, accessor) {
      doc2.write(`if (!(${accessor} instanceof Date) || Number.isNaN(${accessor}.getTime())) return INVALID;`);
      return accessor;
    }
    function generateObjectCheck(doc2, ctx, schema, accessor, buildsValue = true) {
      const def = schema._zod.def;
      doc2.write(`if (typeof ${accessor} !== "object" || ${accessor} === null || Array.isArray(${accessor})) return INVALID;`);
      const shape = def.shape;
      const keys = Object.keys(shape);
      const symbolKeys = Object.getOwnPropertySymbols(shape);
      const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
      const keyExpr = (k) => typeof k === "symbol" ? addConstant(ctx, k) : util2.esc(k);
      const propKey = (k) => typeof k === "symbol" ? `[${keyExpr(k)}]` : util2.esc(k);
      const propShape = shape;
      if (keys.includes("__proto__")) {
        throw new ZodCompileUnsupportedError('object shape key "__proto__"');
      }
      const propOutputs = /* @__PURE__ */ new Map();
      for (const key of allKeys) {
        const propSchema = propShape[key];
        const kx = keyExpr(key);
        const inputVar = newVar(ctx);
        doc2.write(`const ${inputVar} = ${accessor}[${kx}];`);
        if (propSchema._zod.optin !== void 0) {
          const outputVar2 = newVar(ctx);
          doc2.write(`let ${outputVar2} = (() => {`);
          doc2.indented((d) => {
            const outputAccessor = compileChild(d, ctx, propSchema, inputVar);
            d.write(`return ${outputAccessor};`);
          });
          doc2.write(`})();`);
          if (propSchema._zod.optout === "optional") {
            doc2.write(`if (${outputVar2} === INVALID) {`);
            doc2.indented((d) => {
              d.write(`if (${kx} in ${accessor}) return INVALID;`);
              d.write(`${outputVar2} = undefined;`);
            });
            doc2.write(`}`);
          } else {
            doc2.write(`if (${outputVar2} === INVALID) return INVALID;`);
          }
          propOutputs.set(key, outputVar2);
        } else {
          if (requiresPresenceCheck(propSchema)) {
            doc2.write(`if (!(${kx} in ${accessor})) return INVALID;`);
          }
          const outputAccessor = compileChild(doc2, ctx, propSchema, inputVar, buildsValue);
          if (outputAccessor !== null)
            propOutputs.set(key, outputAccessor);
        }
      }
      const catchall = def.catchall;
      let unknownKeysMode = "none";
      if (catchall) {
        const catchallType = catchall._zod.def.type;
        if (catchallType === "never") {
          const condition = keys.map((k) => `k !== ${util2.esc(k)}`).join(" && ") || "true";
          doc2.write(`for (const k in ${accessor}) {`);
          doc2.indented((d) => {
            d.write(`if (${condition}) return INVALID;`);
          });
          doc2.write(`}`);
        } else if ((catchallType === "unknown" || catchallType === "any") && !catchall._zod.def.checks?.length) {
          unknownKeysMode = "passthrough";
        } else {
          unknownKeysMode = "schema";
        }
      }
      const outputVar = newVar(ctx);
      const hasConditionalKeys = allKeys.some((k) => mayOmitUndefined(propShape[k]) || dropsWhenAbsent(propShape[k]));
      if (!buildsValue) {
        if (unknownKeysMode === "schema") {
          const knownSet = keys.length > 0 ? addConstant(ctx, new Set(keys)) : null;
          doc2.write(`for (const k in ${accessor}) {`);
          doc2.indented((d) => {
            d.write(`if (k === "__proto__") continue;`);
            if (knownSet)
              d.write(`if (${knownSet}.has(k)) continue;`);
            const valVar = newVar(ctx);
            d.write(`const ${valVar} = ${accessor}[k];`);
            compileChild(d, ctx, catchall, valVar, false);
          });
          doc2.write(`}`);
        }
        return null;
      }
      if (!hasConditionalKeys) {
        const propLiterals = allKeys.map((k) => `${propKey(k)}: ${propOutputs.get(k)}`).join(", ");
        doc2.write(`const ${outputVar} = { ${propLiterals} };`);
      } else {
        doc2.write(`const ${outputVar} = {};`);
        for (const k of allKeys) {
          const kx = keyExpr(k);
          const out = propOutputs.get(k);
          if (dropsWhenAbsent(propShape[k])) {
            doc2.write(`if (${kx} in ${accessor}) ${outputVar}[${kx}] = ${out};`);
          } else if (mayOmitUndefined(propShape[k])) {
            doc2.write(`if (${out} !== undefined || ${kx} in ${accessor}) ${outputVar}[${kx}] = ${out};`);
          } else {
            doc2.write(`${outputVar}[${kx}] = ${out};`);
          }
        }
      }
      if (unknownKeysMode !== "none") {
        const knownSet = keys.length > 0 ? addConstant(ctx, new Set(keys)) : null;
        doc2.write(`for (const k in ${accessor}) {`);
        doc2.indented((d) => {
          d.write(`if (k === "__proto__") continue;`);
          if (knownSet)
            d.write(`if (${knownSet}.has(k)) continue;`);
          if (unknownKeysMode === "passthrough") {
            d.write(`${outputVar}[k] = ${accessor}[k];`);
          } else {
            const valVar = newVar(ctx);
            d.write(`const ${valVar} = ${accessor}[k];`);
            const catchallOut = compileChild(d, ctx, catchall, valVar);
            d.write(`${outputVar}[k] = ${catchallOut};`);
          }
        });
        doc2.write(`}`);
      }
      return outputVar;
    }
    function generateOptionalCheck(doc2, ctx, schema, accessor, buildsValue = true) {
      const def = schema._zod.def;
      if (isExactOptional(schema)) {
        return generateCheck(doc2, ctx, def.innerType, accessor, buildsValue);
      }
      if (def.innerType._zod.optin === "defaulted") {
        const outputVar2 = newVar(ctx);
        const branchVar = newVar(ctx);
        doc2.write(`let ${outputVar2};`);
        doc2.write(`if (${accessor} === undefined) {`);
        doc2.indented((d) => {
          d.write(`const ${branchVar} = (() => {`);
          d.indented((d2) => {
            const innerOutput = generateCheck(d2, ctx, def.innerType, accessor);
            d2.write(`return ${innerOutput};`);
          });
          d.write(`})();`);
          d.write(`if (${branchVar} !== INVALID) ${outputVar2} = ${branchVar};`);
        });
        doc2.write(`} else {`);
        doc2.indented((d) => {
          const innerOutput = generateCheck(d, ctx, def.innerType, accessor);
          d.write(`${outputVar2} = ${innerOutput};`);
        });
        doc2.write(`}`);
        return outputVar2;
      }
      const outputVar = buildsValue ? newVar(ctx) : null;
      if (outputVar)
        doc2.write(`let ${outputVar};`);
      doc2.write(`if (${accessor} !== undefined) {`);
      doc2.indented((d) => {
        const innerOutput = generateCheck(d, ctx, def.innerType, accessor, buildsValue);
        if (outputVar && innerOutput !== null)
          d.write(`${outputVar} = ${innerOutput};`);
      });
      doc2.write(`}`);
      return outputVar;
    }
    function isExactOptional(schema) {
      return schema._zod.traits?.has("$ZodExactOptional") === true;
    }
    function requiresPresenceCheck(schema) {
      return schema._zod.optin === void 0 && fastPathAcceptsAbsence(schema);
    }
    function fastPathAcceptsAbsence(schema) {
      if (schema._zod.def.coerce)
        return true;
      const def = schema._zod.def;
      switch (def.type) {
        case "any":
        case "unknown":
        case "undefined":
        case "void":
        case "default":
        case "prefault":
        case "transform":
        case "custom":
        case "lazy":
          return true;
        case "string":
        case "number":
        case "boolean":
        case "bigint":
        case "symbol":
        case "null":
        case "never":
        case "nan":
        case "date":
        case "object":
        case "array":
        case "tuple":
        case "record":
        case "map":
        case "set":
        case "file":
        case "template_literal":
          return false;
        case "nonoptional":
          return def.innerType ? fastPathAcceptsAbsence(def.innerType) : false;
        case "literal":
          return !!def.values?.includes(void 0);
        case "enum":
          return !!schema._zod.values?.has(void 0);
        case "optional":
        case "nullable":
        case "readonly":
        case "success":
          return def.innerType ? fastPathAcceptsAbsence(def.innerType) : true;
        case "catch":
          return true;
        case "union":
          return def.options ? def.options.some(fastPathAcceptsAbsence) : true;
        case "intersection":
          if (!def.left || !def.right)
            return true;
          return fastPathAcceptsAbsence(def.left) && fastPathAcceptsAbsence(def.right);
        case "pipe":
          return def.in ? fastPathAcceptsAbsence(def.in) : true;
        default:
          return true;
      }
    }
    function dropsWhenAbsent(schema) {
      return schema._zod.optin === "optional" && schema._zod.optout === "optional";
    }
    function mayOmitUndefined(schema) {
      return (schema._zod.optin !== "defaulted" || schema._zod.optout === "optional") && mayOutputUndefined(schema);
    }
    function mayOutputUndefined(schema) {
      const def = schema._zod.def;
      switch (def.type) {
        case "string":
        case "number":
        case "boolean":
        case "bigint":
        case "symbol":
        case "null":
        case "nan":
        case "date":
        case "object":
        case "array":
        case "tuple":
        case "record":
        case "map":
        case "set":
        case "file":
        case "template_literal":
        case "never":
        case "success":
          return false;
        case "literal":
          return !!def.values?.includes(void 0);
        case "enum":
          return !!schema._zod.values?.has(void 0);
        case "optional":
          return true;
        case "nullable":
        case "readonly":
        case "nonoptional":
          return def.innerType ? mayOutputUndefined(def.innerType) : true;
        case "union":
          return def.options ? def.options.some(mayOutputUndefined) : true;
        case "intersection":
          return !def.left || !def.right || mayOutputUndefined(def.left) || mayOutputUndefined(def.right);
        case "pipe":
          return def.out ? mayOutputUndefined(def.out) : true;
        default:
          return true;
      }
    }
    function generateNullableCheck(doc2, ctx, schema, accessor, buildsValue = true) {
      const def = schema._zod.def;
      const outputVar = buildsValue ? newVar(ctx) : null;
      if (outputVar)
        doc2.write(`let ${outputVar} = null;`);
      doc2.write(`if (${accessor} !== null) {`);
      doc2.indented((d) => {
        const innerOutput = generateCheck(d, ctx, def.innerType, accessor, buildsValue);
        if (outputVar && innerOutput !== null)
          d.write(`${outputVar} = ${innerOutput};`);
      });
      doc2.write(`}`);
      return outputVar;
    }
    function generateSizeGate(doc2, schema, size) {
      for (const [max, check] of util2.sizeCaps(schema._zod.def.checks)) {
        doc2.write(`if (${size} > ${numericOperand(max, check._zod.def.check)}) return INVALID;`);
      }
    }
    function generateArrayCheck(doc2, ctx, schema, accessor, buildsValue = true) {
      const def = schema._zod.def;
      doc2.write(`if (!Array.isArray(${accessor})) return INVALID;`);
      generateSizeGate(doc2, schema, `${accessor}.length`);
      const outputVar = buildsValue ? newVar(ctx) : null;
      const iVar = newVar(ctx);
      const elemVar = newVar(ctx);
      if (outputVar)
        doc2.write(`const ${outputVar} = new Array(${accessor}.length);`);
      doc2.write(`for (let ${iVar} = 0; ${iVar} < ${accessor}.length; ${iVar}++) {`);
      doc2.indented((d) => {
        d.write(`const ${elemVar} = ${accessor}[${iVar}];`);
        const elemOutput = compileChild(d, ctx, def.element, elemVar, buildsValue);
        if (outputVar && elemOutput !== null)
          d.write(`${outputVar}[${iVar}] = ${elemOutput};`);
      });
      doc2.write(`}`);
      return outputVar;
    }
    function generateLiteralCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      const values = def.values;
      if (values.length !== 1) {
        const literalSet = addConstant(ctx, new Set(values));
        doc2.write(`if (!${literalSet}.has(${accessor})) return INVALID;`);
        return accessor;
      }
      const value = values[0];
      if (typeof value === "number" && Number.isNaN(value)) {
        const literalSet = addConstant(ctx, new Set(values));
        doc2.write(`if (!${literalSet}.has(${accessor})) return INVALID;`);
        return accessor;
      }
      if (typeof value === "string") {
        doc2.write(`if (${accessor} !== ${util2.esc(value)}) return INVALID;`);
      } else if (typeof value === "number" || typeof value === "boolean") {
        doc2.write(`if (${accessor} !== ${value}) return INVALID;`);
      } else if (value === null) {
        doc2.write(`if (${accessor} !== null) return INVALID;`);
      } else if (value === void 0) {
        doc2.write(`if (${accessor} !== undefined) return INVALID;`);
      } else if (typeof value === "bigint") {
        doc2.write(`if (${accessor} !== ${value}n) return INVALID;`);
      } else {
        throw new ZodCompileUnsupportedError(`literal type ${typeof value}`);
      }
      return accessor;
    }
    function generateEnumCheck(doc2, ctx, schema, accessor) {
      const values = schema._zod.values;
      if (!values) {
        throw new ZodCompileUnsupportedError("enum schema without enumerated values");
      }
      const enumSet = addConstant(ctx, values);
      doc2.write(`if (!${enumSet}.has(${accessor})) return INVALID;`);
      return accessor;
    }
    function generateWrapperCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      return generateCheck(doc2, ctx, def.innerType, accessor);
    }
    function generateDefaultCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      const descriptor = Object.getOwnPropertyDescriptor(schema._zod.def, "defaultValue");
      const defaultGetter = descriptor ? () => schema._zod.def.defaultValue : void 0;
      if (schema._zod.def.type === "prefault") {
        if (!defaultGetter) {
          return generateCheck(doc2, ctx, def.innerType, accessor);
        }
        const defaultFn = addConstant(ctx, defaultGetter);
        const inputVar = newVar(ctx);
        doc2.write(`let ${inputVar} = ${accessor};`);
        doc2.write(`if (${accessor} === undefined) ${inputVar} = ${defaultFn}();`);
        return generateCheck(doc2, ctx, def.innerType, inputVar);
      }
      const outputVar = newVar(ctx);
      if (defaultGetter) {
        const defaultFn = addConstant(ctx, defaultGetter);
        const cloneFn = addConstant(ctx, util2.shallowClone);
        doc2.write(`let ${outputVar};`);
        doc2.write(`if (${accessor} === undefined) {`);
        doc2.indented((d) => {
          d.write(`${outputVar} = ${cloneFn}(${defaultFn}());`);
        });
        doc2.write(`} else {`);
        doc2.indented((d) => {
          const innerOutput = generateCheck(d, ctx, def.innerType, accessor);
          d.write(`${outputVar} = ${innerOutput} === undefined ? ${cloneFn}(${defaultFn}()) : ${innerOutput};`);
        });
        doc2.write(`}`);
      } else {
        doc2.write(`let ${outputVar};`);
        doc2.write(`if (${accessor} !== undefined) {`);
        doc2.indented((d) => {
          const innerOutput = generateCheck(d, ctx, def.innerType, accessor);
          d.write(`${outputVar} = ${innerOutput};`);
        });
        doc2.write(`}`);
      }
      return outputVar;
    }
    function generateNonOptionalCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      const innerOutput = generateCheck(doc2, ctx, def.innerType, accessor);
      const outputVar = newVar(ctx);
      doc2.write(`const ${outputVar} = ${innerOutput};`);
      doc2.write(`if (${outputVar} === undefined) return INVALID;`);
      return outputVar;
    }
    function generateTupleCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      const items = def.items;
      const rest = def.rest;
      doc2.write(`if (!Array.isArray(${accessor})) return INVALID;`);
      const optinStart = getTupleOptStart(items, "optin");
      const optoutStart = getTupleOptStart(items, "optout");
      if (rest) {
        doc2.write(`if (${accessor}.length < ${optinStart}) return INVALID;`);
      } else {
        doc2.write(`if (${accessor}.length < ${optinStart} || ${accessor}.length > ${items.length}) return INVALID;`);
      }
      const outputVar = newVar(ctx);
      doc2.write(`const ${outputVar} = [];`);
      for (let i = 0; i < items.length; i++) {
        const itemSchema = items[i];
        if (i >= optoutStart) {
          doc2.write(`if (${outputVar}.length === ${i}) {`);
          doc2.indented((d) => {
            d.write(`if (${i} < ${accessor}.length) {`);
            d.indented((d2) => {
              const elemVar = newVar(ctx);
              d2.write(`const ${elemVar} = ${accessor}[${i}];`);
              const elemOutput = compileChild(d2, ctx, itemSchema, elemVar);
              d2.write(`${outputVar}[${i}] = ${elemOutput};`);
            });
            d.write(`} else {`);
            d.indented((d2) => {
              if (dropsWhenAbsent(itemSchema)) {
                d2.write(`${outputVar}.length = ${i};`);
                return;
              }
              const elemVar = newVar(ctx);
              const branchVar = newVar(ctx);
              d2.write(`const ${elemVar} = undefined;`);
              d2.write(`const ${branchVar} = (() => {`);
              d2.indented((d3) => {
                const elemOutput = compileChild(d3, ctx, itemSchema, elemVar);
                d3.write(`return ${elemOutput};`);
              });
              d2.write(`})();`);
              d2.write(`if (${branchVar} === INVALID || ${branchVar} === undefined) ${outputVar}.length = ${i};`);
              d2.write(`else ${outputVar}[${i}] = ${branchVar};`);
            });
            d.write(`}`);
          });
          doc2.write(`}`);
        } else {
          const elemVar = newVar(ctx);
          doc2.write(`const ${elemVar} = ${accessor}[${i}];`);
          const elemOutput = compileChild(doc2, ctx, itemSchema, elemVar);
          doc2.write(`${outputVar}[${i}] = ${elemOutput};`);
        }
      }
      if (rest) {
        const iVar = newVar(ctx);
        const elemVar = newVar(ctx);
        doc2.write(`for (let ${iVar} = ${items.length}; ${iVar} < ${accessor}.length; ${iVar}++) {`);
        doc2.indented((d) => {
          d.write(`const ${elemVar} = ${accessor}[${iVar}];`);
          const elemOutput = compileChild(d, ctx, rest, elemVar);
          d.write(`${outputVar}[${iVar}] = ${elemOutput};`);
        });
        doc2.write(`}`);
      }
      return outputVar;
    }
    function getTupleOptStart(items, key) {
      for (let i = items.length - 1; i >= 0; i--) {
        const omittable = key === "optin" ? items[i]._zod.optin !== void 0 : items[i]._zod.optout === "optional";
        if (!omittable)
          return i + 1;
      }
      return 0;
    }
    function generateUnionCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      const options = def.options;
      if (def.discriminator) {
        return generateDiscriminatedUnionCheck(doc2, ctx, def, accessor);
      }
      if (def.inclusive === false) {
        throw new ZodCompileUnsupportedError("exclusive unions (z.xor)");
      }
      if (options.length === 0) {
        doc2.write("return INVALID;");
        return accessor;
      }
      if (options.length === 1) {
        return generateCheck(doc2, ctx, options[0], accessor);
      }
      const allLiterals = options.every((opt) => opt._zod.def.type === "literal" && !opt._zod.def.checks?.length);
      if (allLiterals) {
        const values = new Set(options.flatMap((opt) => opt._zod.def.values));
        const valuesConst = addConstant(ctx, values);
        doc2.write(`if (!${valuesConst}.has(${accessor})) return INVALID;`);
        return accessor;
      }
      const outputVar = newVar(ctx);
      doc2.write(`let ${outputVar};`);
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        if (i === 0) {
          doc2.write(`${outputVar} = (() => {`);
        } else {
          doc2.write(`if (${outputVar} === INVALID) ${outputVar} = (() => {`);
        }
        doc2.indented((d) => {
          const branchOutput = generateCheck(d, ctx, opt, accessor);
          d.write(`return ${branchOutput};`);
        });
        doc2.write(`})();`);
      }
      doc2.write(`if (${outputVar} === INVALID) return INVALID;`);
      return outputVar;
    }
    function generateDiscriminatedUnionCheck(doc2, ctx, def, accessor) {
      if (def.unionFallback) {
        throw new ZodCompileUnsupportedError("discriminated union with unionFallback");
      }
      if (def.options.length === 0) {
        doc2.write("return INVALID;");
        return accessor;
      }
      const discVar = newVar(ctx);
      const outputVar = newVar(ctx);
      doc2.write(`const ${discVar} = ${accessor}?.[${util2.esc(def.discriminator)}];`);
      doc2.write(`let ${outputVar};`);
      let firstBranch = true;
      const claimed = /* @__PURE__ */ new Set();
      for (const option of def.options) {
        const values = option._zod.propValues?.[def.discriminator];
        if (!values || values.size === 0) {
          throw new ZodCompileUnsupportedError("discriminated union option without static discriminator values");
        }
        for (const value of values) {
          if (claimed.has(value)) {
            throw new ZodCompileUnsupportedError(`duplicate discriminator value ${String(value)}`);
          }
          claimed.add(value);
        }
        const conditions = Array.from(values, (value) => literalEquality(ctx, discVar, value));
        const prefix = firstBranch ? "if" : "else if";
        doc2.write(`${prefix} (${conditions.join(" || ")}) {`);
        doc2.indented((d) => {
          const branchOutput = generateCheck(d, ctx, option, accessor);
          d.write(`${outputVar} = ${branchOutput};`);
        });
        doc2.write(`}`);
        firstBranch = false;
      }
      doc2.write(`else { return INVALID; }`);
      return outputVar;
    }
    function literalEquality(ctx, accessor, value) {
      if (typeof value === "string")
        return `${accessor} === ${util2.esc(value)}`;
      if (typeof value === "number") {
        if (Number.isNaN(value))
          return `Number.isNaN(${accessor})`;
        return `${accessor} === ${value}`;
      }
      if (typeof value === "boolean")
        return `${accessor} === ${value}`;
      if (value === null)
        return `${accessor} === null`;
      if (value === void 0)
        return `${accessor} === undefined`;
      if (typeof value === "bigint")
        return `${accessor} === ${value}n`;
      if (typeof value === "symbol") {
        const symbolConst = addConstant(ctx, value);
        return `${accessor} === ${symbolConst}`;
      }
      throw new ZodCompileUnsupportedError(`literal discriminator value ${String(value)}`);
    }
    function generateIntersectionCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      ctx.definite = false;
      const leftOutput = compileChild(doc2, ctx, def.left, accessor);
      const rightOutput = compileChild(doc2, ctx, def.right, accessor);
      const mergeConst = addConstant(ctx, schemas_js_1.mergeValues);
      const mergedVar = newVar(ctx);
      doc2.write(`const ${mergedVar} = ${mergeConst}(${leftOutput}, ${rightOutput});`);
      doc2.write(`if (!${mergedVar}.valid) return INVALID;`);
      return `${mergedVar}.data`;
    }
    function generateRecordCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      const isPlainObjectConst = addConstant(ctx, util2.isPlainObject);
      doc2.write(`if (!${isPlainObjectConst}(${accessor})) return INVALID;`);
      const outputVar = newVar(ctx);
      const kVar = newVar(ctx);
      const valVar = newVar(ctx);
      doc2.write(`const ${outputVar} = {};`);
      const recordDef = def;
      const keyValues = recordDef.partial ? void 0 : def.keyType._zod.values;
      if (keyValues) {
        const inputKeys = [];
        for (const key of keyValues) {
          if (!(typeof key === "string" || typeof key === "number" || typeof key === "symbol")) {
            throw new ZodCompileUnsupportedError(`record key value ${String(key)}`);
          }
          const inputKey = typeof key === "number" ? key.toString() : key;
          if (inputKey === "__proto__") {
            throw new ZodCompileUnsupportedError('record key "__proto__"');
          }
          inputKeys.push(inputKey);
          const keyConst = addConstant(ctx, key);
          const outKey = generateCheck(doc2, ctx, def.keyType, keyConst);
          const valueVar = newVar(ctx);
          doc2.write(`const ${valueVar} = ${accessor}[${literalPropertyKey(ctx, inputKey)}];`);
          const valOutput = compileChild(doc2, ctx, def.valueType, valueVar);
          doc2.write(`${outputVar}[${outKey}] = ${valOutput};`);
        }
        const knownKeysConst = addConstant(ctx, new Set(inputKeys));
        doc2.write(`for (const ${kVar} in ${accessor}) {`);
        doc2.indented((d) => {
          d.write(`if (${knownKeysConst}.has(${kVar})) continue;`);
          if (recordDef.mode === "loose") {
            d.write(`if (${kVar} !== "__proto__") ${outputVar}[${kVar}] = ${accessor}[${kVar}];`);
          } else {
            d.write(`return INVALID;`);
          }
        });
        doc2.write(`}`);
        return outputVar;
      }
      const keyDef = def.keyType._zod.def;
      const keyIsBareString = keyDef.type === "string" && keyDef.format === void 0 && !keyDef.coerce && (keyDef.checks?.length ?? 0) === 0;
      if (!keyIsBareString) {
        const isLoose = def.mode === "loose";
        const keyFn = compileFn(def.keyType);
        if (keyFn.definite === false)
          ctx.definite = false;
        const keyFast = addConstant(ctx, keyFn);
        const numericConst = addConstant(ctx, regexes2.number);
        const outKeyVar = newVar(ctx);
        emitOwnKeys(doc2, ctx, accessor, kVar, (d) => {
          d.write(`let ${outKeyVar} = ${keyFast}(${kVar});`);
          d.write(`if (${outKeyVar} === INVALID && typeof ${kVar} === "string" && ${numericConst}.test(${kVar})) ${outKeyVar} = ${keyFast}(Number(${kVar}));`);
          if (isLoose) {
            d.write(`if (${outKeyVar} === INVALID) { ${outputVar}[${kVar}] = ${accessor}[${kVar}]; continue; }`);
          } else {
            d.write(`if (${outKeyVar} === INVALID) return INVALID;`);
          }
          d.write(`if (${outKeyVar} === "__proto__") continue;`);
          const valueVar = newVar(ctx);
          d.write(`const ${valueVar} = ${accessor}[${kVar}];`);
          const valOutput = compileChild(d, ctx, def.valueType, valueVar);
          d.write(`${outputVar}[${outKeyVar}] = ${valOutput};`);
        });
        return outputVar;
      }
      emitOwnKeys(doc2, ctx, accessor, kVar, (d) => {
        d.write(`const ${valVar} = ${accessor}[${kVar}];`);
        const valOutput = compileChild(d, ctx, def.valueType, valVar);
        d.write(`${outputVar}[${kVar}] = ${valOutput};`);
      }, `return INVALID;`);
      return outputVar;
    }
    function emitOwnKeys(doc2, ctx, accessor, kVar, body, onSymbol) {
      const propIsEnumerableConst = addConstant(ctx, Object.prototype.propertyIsEnumerable);
      const symsVar = newVar(ctx);
      const keysVar = newVar(ctx);
      const iVar = newVar(ctx);
      doc2.write(`const ${symsVar} = Object.getOwnPropertySymbols(${accessor});`);
      doc2.write(`const ${keysVar} = Object.getOwnPropertyNames(${accessor});`);
      doc2.write(`for (let ${iVar} = 0; ${iVar} < ${keysVar}.length; ${iVar}++) {`);
      doc2.indented((d) => {
        d.write(`const ${kVar} = ${keysVar}[${iVar}];`);
        d.write(`if (${kVar} === "__proto__" || !${propIsEnumerableConst}.call(${accessor}, ${kVar})) continue;`);
        body(d);
      });
      doc2.write(`}`);
      doc2.write(`for (let ${iVar} = 0; ${iVar} < ${symsVar}.length; ${iVar}++) {`);
      doc2.indented((d) => {
        d.write(`const ${kVar} = ${symsVar}[${iVar}];`);
        d.write(`if (!${propIsEnumerableConst}.call(${accessor}, ${kVar})) continue;`);
        if (onSymbol)
          d.write(onSymbol);
        else
          body(d);
      });
      doc2.write(`}`);
    }
    function literalPropertyKey(ctx, key) {
      if (typeof key === "string")
        return util2.esc(key);
      return addConstant(ctx, key);
    }
    function generateMapCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      doc2.write(`if (!(${accessor} instanceof Map)) return INVALID;`);
      generateSizeGate(doc2, schema, `${accessor}.size`);
      const outputVar = newVar(ctx);
      const kVar = newVar(ctx);
      const valVar = newVar(ctx);
      doc2.write(`const ${outputVar} = new Map();`);
      doc2.write(`for (const [${kVar}, ${valVar}] of ${accessor}) {`);
      doc2.indented((d) => {
        const keyOutput = generateCheck(d, ctx, def.keyType, kVar);
        const valOutput = generateCheck(d, ctx, def.valueType, valVar);
        d.write(`${outputVar}.set(${keyOutput}, ${valOutput});`);
      });
      doc2.write(`}`);
      return outputVar;
    }
    function generateSetCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      doc2.write(`if (!(${accessor} instanceof Set)) return INVALID;`);
      generateSizeGate(doc2, schema, `${accessor}.size`);
      const outputVar = newVar(ctx);
      const valVar = newVar(ctx);
      doc2.write(`const ${outputVar} = new Set();`);
      doc2.write(`for (const ${valVar} of ${accessor}) {`);
      doc2.indented((d) => {
        const valOutput = generateCheck(d, ctx, def.valueType, valVar);
        d.write(`${outputVar}.add(${valOutput});`);
      });
      doc2.write(`}`);
      return outputVar;
    }
    function generateFileCheck(doc2, accessor) {
      doc2.write(`if (!(${accessor} instanceof File)) return INVALID;`);
      return accessor;
    }
    function generateTemplateLiteralCheck(doc2, ctx, schema, accessor) {
      doc2.write(`if (typeof ${accessor} !== "string") return INVALID;`);
      const pattern = schema._zod.pattern;
      if (pattern) {
        const patternConst = addConstant(ctx, pattern);
        doc2.write(`${patternConst}.lastIndex = 0;`);
        doc2.write(`if (!${patternConst}.test(${accessor})) return INVALID;`);
      }
      return accessor;
    }
    function generateLazyCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      const getterConst = addUserConstant(ctx, def.getter);
      const cacheConst = addConstant(ctx, { parser: null });
      doc2.write(`if (!${cacheConst}.parser) {`);
      doc2.indented((d) => {
        d.write(`const inner = ${getterConst}();`);
        d.write(`${cacheConst}.parser = function(input) {`);
        d.indented((d2) => {
          d2.write(`const result = inner._zod.run({ value: input, issues: [] }, {});`);
          d2.write(`return result.issues.length === 0 ? result.value : INVALID;`);
        });
        d.write(`};`);
      });
      doc2.write(`}`);
      const outputVar = newVar(ctx);
      doc2.write(`const ${outputVar} = ${cacheConst}.parser(${accessor});`);
      doc2.write(`if (${outputVar} === INVALID) return INVALID;`);
      return outputVar;
    }
    function generatePipeCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      const inputOutput = generateCheck(doc2, ctx, def.in, accessor);
      if (def.transform) {
        if (isAsyncFunction(def.transform)) {
          throw new ZodCompileAsyncError("z.compile: async transforms in pipes are not supported");
        }
        const transformFn = def.transform;
        const helperFn = (value) => {
          const fakePayload = { value, issues: [], addIssue: pushIssue };
          const result = transformFn(value, fakePayload);
          if (result instanceof Promise)
            return exports2.INVALID;
          return fakePayload.issues.length === 0 ? result : exports2.INVALID;
        };
        const helperConst = addUserConstant(ctx, helperFn);
        const transformedVar = newVar(ctx);
        doc2.write(`const ${transformedVar} = ${helperConst}(${inputOutput});`);
        doc2.write(`if (${transformedVar} === INVALID) return INVALID;`);
        return generateCheck(doc2, ctx, def.out, transformedVar);
      } else {
        return generateCheck(doc2, ctx, def.out, inputOutput);
      }
    }
    function isAsyncFunction(fn) {
      return typeof fn === "function" && (fn.constructor.name === "AsyncFunction" || fn[Symbol.toStringTag] === "AsyncFunction");
    }
    function generateCustomCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      if (def.fn) {
        if (isAsyncFunction(def.fn)) {
          throw new ZodCompileAsyncError("z.compile: async custom predicates are not supported");
        }
        const fnConst = addUserConstant(ctx, def.fn);
        const throwAsyncConst = addConstant(ctx, throwAsync);
        const resVar = newVar(ctx);
        doc2.write(`const ${resVar} = ${fnConst}(${accessor});`);
        doc2.write(`if (${resVar} instanceof Promise) ${throwAsyncConst}();`);
        doc2.write(`if (!${resVar}) return INVALID;`);
      } else {
        throw new ZodCompileUnsupportedError("custom schema without a predicate function");
      }
      return accessor;
    }
    function runtimeCatch(innerSchema, catchValue, value) {
      const result = innerSchema._zod.run({ value, issues: [] }, {});
      if (result && typeof result.then === "function")
        return exports2.INVALID;
      const r = result;
      if (r.issues.length === 0)
        return r.value;
      return catchValue();
    }
    function generateCatchCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      if (!def.catchValue[util2.CONSTANT_CATCH]) {
        throw new ZodCompileUnsupportedError("catch with a callback (only a constant catch value compiles)", false);
      }
      const outputVar = newVar(ctx);
      doc2.write(`let ${outputVar} = (() => {`);
      doc2.indented((d) => {
        const innerOut = compileChild(d, ctx, def.innerType, accessor);
        d.write(`return ${innerOut};`);
      });
      doc2.write(`})();`);
      const innerConst = addConstant(ctx, def.innerType);
      const catchConst = addUserConstant(ctx, def.catchValue);
      const catchHelperConst = addConstant(ctx, runtimeCatch);
      doc2.write(`if (${outputVar} === INVALID) {`);
      doc2.indented((d) => {
        d.write(`${outputVar} = ${catchHelperConst}(${innerConst}, ${catchConst}, ${accessor});`);
        d.write(`if (${outputVar} === INVALID) return INVALID;`);
      });
      doc2.write(`}`);
      return outputVar;
    }
    function generateTransformCheck(doc2, ctx, schema, accessor) {
      const def = schema._zod.def;
      if (def.transform) {
        if (isAsyncFunction(def.transform)) {
          throw new ZodCompileAsyncError("z.compile: async transforms are not supported");
        }
        const transformFn = def.transform;
        const helperFn = (value) => {
          const fakePayload = { value, issues: [], addIssue: pushIssue };
          const result = transformFn(value, fakePayload);
          if (result instanceof Promise)
            return exports2.INVALID;
          return fakePayload.issues.length === 0 ? result : exports2.INVALID;
        };
        const helperConst = addUserConstant(ctx, helperFn);
        const outputVar = newVar(ctx);
        doc2.write(`const ${outputVar} = ${helperConst}(${accessor});`);
        doc2.write(`if (${outputVar} === INVALID) return INVALID;`);
        return outputVar;
      }
      return accessor;
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(compile);
  return compile;
}
var api$1 = {};
var hasRequiredApi;
function requireApi() {
  if (hasRequiredApi) return api$1;
  hasRequiredApi = 1;
  (function(exports2) {
    var __createBinding = api$1 && api$1.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = api$1 && api$1.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = api$1 && api$1.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.TimePrecision = void 0;
    exports2._string = _string;
    exports2._coercedString = _coercedString;
    exports2._email = _email;
    exports2._guid = _guid;
    exports2._uuid = _uuid;
    exports2._uuidv4 = _uuidv4;
    exports2._uuidv6 = _uuidv6;
    exports2._uuidv7 = _uuidv7;
    exports2._url = _url;
    exports2._emoji = _emoji;
    exports2._nanoid = _nanoid;
    exports2._cuid = _cuid;
    exports2._cuid2 = _cuid2;
    exports2._ulid = _ulid;
    exports2._xid = _xid;
    exports2._ksuid = _ksuid;
    exports2._ipv4 = _ipv4;
    exports2._ipv6 = _ipv6;
    exports2._mac = _mac;
    exports2._cidrv4 = _cidrv4;
    exports2._cidrv6 = _cidrv6;
    exports2._base64 = _base64;
    exports2._base64url = _base64url;
    exports2._e164 = _e164;
    exports2._creditCard = _creditCard;
    exports2._iban = _iban;
    exports2._jwt = _jwt;
    exports2._isoDateTime = _isoDateTime;
    exports2._isoDate = _isoDate;
    exports2._isoTime = _isoTime;
    exports2._isoDuration = _isoDuration;
    exports2._number = _number;
    exports2._coercedNumber = _coercedNumber;
    exports2._int = _int;
    exports2._float32 = _float32;
    exports2._float64 = _float64;
    exports2._int32 = _int32;
    exports2._uint32 = _uint32;
    exports2._boolean = _boolean;
    exports2._coercedBoolean = _coercedBoolean;
    exports2._bigint = _bigint;
    exports2._coercedBigint = _coercedBigint;
    exports2._int64 = _int64;
    exports2._uint64 = _uint64;
    exports2._symbol = _symbol;
    exports2._undefined = _undefined;
    exports2._null = _null;
    exports2._any = _any;
    exports2._unknown = _unknown;
    exports2._never = _never;
    exports2._void = _void;
    exports2._date = _date;
    exports2._coercedDate = _coercedDate;
    exports2._nan = _nan;
    exports2._lt = _lt;
    exports2._lte = _lte;
    exports2._max = _lte;
    exports2._lte = _lte;
    exports2._max = _lte;
    exports2._gt = _gt;
    exports2._gte = _gte;
    exports2._min = _gte;
    exports2._gte = _gte;
    exports2._min = _gte;
    exports2._positive = _positive;
    exports2._negative = _negative;
    exports2._nonpositive = _nonpositive;
    exports2._nonnegative = _nonnegative;
    exports2._multipleOf = _multipleOf;
    exports2._maxSize = _maxSize;
    exports2._minSize = _minSize;
    exports2._size = _size;
    exports2._maxLength = _maxLength;
    exports2._minLength = _minLength;
    exports2._length = _length;
    exports2._regex = _regex;
    exports2._lowercase = _lowercase;
    exports2._uppercase = _uppercase;
    exports2._includes = _includes;
    exports2._startsWith = _startsWith;
    exports2._endsWith = _endsWith;
    exports2._property = _property;
    exports2._properties = _properties;
    exports2._mime = _mime;
    exports2._overwrite = _overwrite;
    exports2._normalize = _normalize;
    exports2._trim = _trim;
    exports2._toLowerCase = _toLowerCase;
    exports2._toUpperCase = _toUpperCase;
    exports2._slugify = _slugify;
    exports2._array = _array;
    exports2._union = _union;
    exports2._xor = _xor;
    exports2._discriminatedUnion = _discriminatedUnion;
    exports2._intersection = _intersection;
    exports2._tuple = _tuple;
    exports2._record = _record;
    exports2._map = _map;
    exports2._set = _set;
    exports2._enum = _enum;
    exports2._nativeEnum = _nativeEnum;
    exports2._literal = _literal;
    exports2._file = _file;
    exports2._transform = _transform;
    exports2._optional = _optional;
    exports2._nullable = _nullable;
    exports2._default = _default;
    exports2._nonoptional = _nonoptional;
    exports2._success = _success;
    exports2._catch = _catch;
    exports2._pipe = _pipe;
    exports2._readonly = _readonly;
    exports2._templateLiteral = _templateLiteral;
    exports2._lazy = _lazy;
    exports2._promise = _promise;
    exports2._custom = _custom;
    exports2._refine = _refine;
    exports2._superRefine = _superRefine;
    exports2._check = _check;
    exports2.describe = describe;
    exports2.meta = meta;
    exports2._stringbool = _stringbool;
    exports2._stringFormat = _stringFormat;
    const checks2 = __importStar(/* @__PURE__ */ requireChecks$1());
    const registries2 = __importStar(/* @__PURE__ */ requireRegistries());
    const schemas2 = __importStar(/* @__PURE__ */ requireSchemas$1());
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
    function snapshotChecks(def) {
      if (def.checks)
        def.checks = [...def.checks];
      return def;
    }
    // @__NO_SIDE_EFFECTS__
    function _string(Class, params) {
      return new Class(snapshotChecks({ type: "string", ...util2.normalizeParams(params) }));
    }
    // @__NO_SIDE_EFFECTS__
    function _coercedString(Class, params) {
      return new Class(snapshotChecks({ type: "string", coerce: true, ...util2.normalizeParams(params) }));
    }
    // @__NO_SIDE_EFFECTS__
    function _email(Class, params) {
      return new Class({
        type: "string",
        format: "email",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _guid(Class, params) {
      return new Class({
        type: "string",
        format: "guid",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _uuid(Class, params) {
      return new Class({
        type: "string",
        format: "uuid",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
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
        ...util2.normalizeParams(params)
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
        ...util2.normalizeParams(params)
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
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _url(Class, params) {
      return new Class({
        type: "string",
        format: "url",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _emoji(Class, params) {
      return new Class({
        type: "string",
        format: "emoji",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _nanoid(Class, params) {
      return new Class({
        type: "string",
        format: "nanoid",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _cuid(Class, params) {
      return new Class({
        type: "string",
        format: "cuid",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _cuid2(Class, params) {
      return new Class({
        type: "string",
        format: "cuid2",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _ulid(Class, params) {
      return new Class({
        type: "string",
        format: "ulid",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _xid(Class, params) {
      return new Class({
        type: "string",
        format: "xid",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _ksuid(Class, params) {
      return new Class({
        type: "string",
        format: "ksuid",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _ipv4(Class, params) {
      return new Class({
        type: "string",
        format: "ipv4",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _ipv6(Class, params) {
      return new Class({
        type: "string",
        format: "ipv6",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _mac(Class, params) {
      return new Class({
        type: "string",
        format: "mac",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _cidrv4(Class, params) {
      return new Class({
        type: "string",
        format: "cidrv4",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _cidrv6(Class, params) {
      return new Class({
        type: "string",
        format: "cidrv6",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _base64(Class, params) {
      return new Class({
        type: "string",
        format: "base64",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _base64url(Class, params) {
      return new Class({
        type: "string",
        format: "base64url",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _e164(Class, params) {
      return new Class({
        type: "string",
        format: "e164",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _creditCard(Class, params) {
      return new Class({
        type: "string",
        format: "credit_card",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _iban(Class, params) {
      return new Class({
        type: "string",
        format: "iban",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _jwt(Class, params) {
      return new Class({
        type: "string",
        format: "jwt",
        check: "string_format",
        abort: false,
        ...util2.normalizeParams(params)
      });
    }
    exports2.TimePrecision = {
      Any: null,
      Minute: -1,
      Second: 0,
      Millisecond: 3,
      Microsecond: 6
    };
    // @__NO_SIDE_EFFECTS__
    function _isoDateTime(Class, params) {
      return new Class({
        type: "string",
        format: "datetime",
        check: "string_format",
        offset: false,
        local: false,
        precision: null,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _isoDate(Class, params) {
      return new Class({
        type: "string",
        format: "date",
        check: "string_format",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _isoTime(Class, params) {
      return new Class({
        type: "string",
        format: "time",
        check: "string_format",
        precision: null,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _isoDuration(Class, params) {
      return new Class({
        type: "string",
        format: "duration",
        check: "string_format",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _number(Class, params) {
      return new Class(snapshotChecks({ type: "number", checks: [], ...util2.normalizeParams(params) }));
    }
    // @__NO_SIDE_EFFECTS__
    function _coercedNumber(Class, params) {
      return new Class(snapshotChecks({ type: "number", coerce: true, checks: [], ...util2.normalizeParams(params) }));
    }
    // @__NO_SIDE_EFFECTS__
    function _int(Class, params) {
      return new Class({
        type: "number",
        check: "number_format",
        abort: false,
        format: "safeint",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _float32(Class, params) {
      return new Class({
        type: "number",
        check: "number_format",
        abort: false,
        format: "float32",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _float64(Class, params) {
      return new Class({
        type: "number",
        check: "number_format",
        abort: false,
        format: "float64",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _int32(Class, params) {
      return new Class({
        type: "number",
        check: "number_format",
        abort: false,
        format: "int32",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _uint32(Class, params) {
      return new Class({
        type: "number",
        check: "number_format",
        abort: false,
        format: "uint32",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _boolean(Class, params) {
      return new Class({
        type: "boolean",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _coercedBoolean(Class, params) {
      return new Class({
        type: "boolean",
        coerce: true,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _bigint(Class, params) {
      return new Class({
        type: "bigint",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _coercedBigint(Class, params) {
      return new Class({
        type: "bigint",
        coerce: true,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _int64(Class, params) {
      return new Class({
        type: "bigint",
        check: "bigint_format",
        abort: false,
        format: "int64",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _uint64(Class, params) {
      return new Class({
        type: "bigint",
        check: "bigint_format",
        abort: false,
        format: "uint64",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _symbol(Class, params) {
      return new Class({
        type: "symbol",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _undefined(Class, params) {
      return new Class({
        type: "undefined",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _null(Class, params) {
      return new Class({
        type: "null",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _any(Class) {
      return new Class({
        type: "any"
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
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _void(Class, params) {
      return new Class({
        type: "void",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _date(Class, params) {
      return new Class({
        type: "date",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _coercedDate(Class, params) {
      return new Class({
        type: "date",
        coerce: true,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _nan(Class, params) {
      return new Class({
        type: "nan",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _lt(value, params) {
      return new checks2.$ZodCheckLessThan({
        check: "less_than",
        ...util2.normalizeParams(params),
        value,
        inclusive: false
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _lte(value, params) {
      return new checks2.$ZodCheckLessThan({
        check: "less_than",
        ...util2.normalizeParams(params),
        value,
        inclusive: true
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _gt(value, params) {
      return new checks2.$ZodCheckGreaterThan({
        check: "greater_than",
        ...util2.normalizeParams(params),
        value,
        inclusive: false
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _gte(value, params) {
      return new checks2.$ZodCheckGreaterThan({
        check: "greater_than",
        ...util2.normalizeParams(params),
        value,
        inclusive: true
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _positive(params) {
      return /* @__PURE__ */ _gt(0, params);
    }
    // @__NO_SIDE_EFFECTS__
    function _negative(params) {
      return /* @__PURE__ */ _lt(0, params);
    }
    // @__NO_SIDE_EFFECTS__
    function _nonpositive(params) {
      return /* @__PURE__ */ _lte(0, params);
    }
    // @__NO_SIDE_EFFECTS__
    function _nonnegative(params) {
      return /* @__PURE__ */ _gte(0, params);
    }
    // @__NO_SIDE_EFFECTS__
    function _multipleOf(value, params) {
      return new checks2.$ZodCheckMultipleOf({
        check: "multiple_of",
        ...util2.normalizeParams(params),
        value
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _maxSize(maximum, params) {
      return new checks2.$ZodCheckMaxSize({
        check: "max_size",
        ...util2.normalizeParams(params),
        maximum
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _minSize(minimum, params) {
      return new checks2.$ZodCheckMinSize({
        check: "min_size",
        ...util2.normalizeParams(params),
        minimum
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _size(size, params) {
      return new checks2.$ZodCheckSizeEquals({
        check: "size_equals",
        ...util2.normalizeParams(params),
        size
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _maxLength(maximum, params) {
      const ch = new checks2.$ZodCheckMaxLength({
        check: "max_length",
        ...util2.normalizeParams(params),
        maximum
      });
      return ch;
    }
    // @__NO_SIDE_EFFECTS__
    function _minLength(minimum, params) {
      return new checks2.$ZodCheckMinLength({
        check: "min_length",
        ...util2.normalizeParams(params),
        minimum
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _length(length, params) {
      return new checks2.$ZodCheckLengthEquals({
        check: "length_equals",
        ...util2.normalizeParams(params),
        length
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _regex(pattern, params) {
      return new checks2.$ZodCheckRegex({
        check: "string_format",
        format: "regex",
        ...util2.normalizeParams(params),
        pattern
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _lowercase(params) {
      return new checks2.$ZodCheckLowerCase({
        check: "string_format",
        format: "lowercase",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _uppercase(params) {
      return new checks2.$ZodCheckUpperCase({
        check: "string_format",
        format: "uppercase",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _includes(includes, params) {
      return new checks2.$ZodCheckIncludes({
        check: "string_format",
        format: "includes",
        ...util2.normalizeParams(params),
        includes
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _startsWith(prefix, params) {
      return new checks2.$ZodCheckStartsWith({
        check: "string_format",
        format: "starts_with",
        ...util2.normalizeParams(params),
        prefix
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _endsWith(suffix, params) {
      return new checks2.$ZodCheckEndsWith({
        check: "string_format",
        format: "ends_with",
        ...util2.normalizeParams(params),
        suffix
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _property(property, schema, params) {
      return new checks2.$ZodCheckProperty({
        check: "property",
        property,
        schema,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _properties(shape, params) {
      return new checks2.$ZodCheckProperties({
        check: "properties",
        shape,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _mime(types, params) {
      return new checks2.$ZodCheckMimeType({
        check: "mime_type",
        mime: types,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _overwrite(tx) {
      return new checks2.$ZodCheckOverwrite({
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
      return /* @__PURE__ */ _overwrite((input) => util2.slugify(input));
    }
    // @__NO_SIDE_EFFECTS__
    function _array(Class, element, params) {
      return new Class({
        type: "array",
        element,
        // get element() {
        //   return element;
        // },
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _union(Class, options, params) {
      return new Class({
        type: "union",
        options,
        ...util2.normalizeParams(params)
      });
    }
    function _xor(Class, options, params) {
      return new Class({
        type: "union",
        options,
        inclusive: false,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _discriminatedUnion(Class, discriminator, options, params) {
      return new Class({
        type: "union",
        options,
        discriminator,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _intersection(Class, left, right) {
      return new Class({
        type: "intersection",
        left,
        right
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _tuple(Class, items, _paramsOrRest, _params) {
      const hasRest = _paramsOrRest instanceof schemas2.$ZodType;
      const params = hasRest ? _params : _paramsOrRest;
      const rest = hasRest ? _paramsOrRest : null;
      return new Class({
        type: "tuple",
        items,
        rest,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _record(Class, keyType, valueType, params) {
      return new Class({
        type: "record",
        keyType,
        valueType,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _map(Class, keyType, valueType, params) {
      return new Class({
        type: "map",
        keyType,
        valueType,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _set(Class, valueType, params) {
      return new Class({
        type: "set",
        valueType,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _enum(Class, values, params) {
      const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
      return new Class({
        type: "enum",
        entries,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _nativeEnum(Class, entries, params) {
      return new Class({
        type: "enum",
        entries,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _literal(Class, value, params) {
      return new Class({
        type: "literal",
        values: Array.isArray(value) ? value : [value],
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _file(Class, params) {
      return new Class({
        type: "file",
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _transform(Class, fn) {
      return new Class({
        type: "transform",
        transform: fn
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _optional(Class, innerType) {
      return new Class({
        type: "optional",
        innerType
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _nullable(Class, innerType) {
      return new Class({
        type: "nullable",
        innerType
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _default(Class, innerType, defaultValue) {
      return new Class({
        type: "default",
        innerType,
        get defaultValue() {
          return typeof defaultValue === "function" ? defaultValue() : util2.shallowClone(defaultValue);
        }
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _nonoptional(Class, innerType, params) {
      return new Class({
        type: "nonoptional",
        innerType,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _success(Class, innerType) {
      return new Class({
        type: "success",
        innerType
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _catch(Class, innerType, catchValue) {
      return new Class({
        type: "catch",
        innerType,
        catchValue: typeof catchValue === "function" ? catchValue : util2.constantCatch(catchValue)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _pipe(Class, in_, out) {
      return new Class({
        type: "pipe",
        in: in_,
        out
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _readonly(Class, innerType) {
      return new Class({
        type: "readonly",
        innerType
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _templateLiteral(Class, parts, params) {
      return new Class({
        type: "template_literal",
        parts,
        ...util2.normalizeParams(params)
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _lazy(Class, getter) {
      return new Class({
        type: "lazy",
        getter
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _promise(Class, innerType) {
      return new Class({
        type: "promise",
        innerType
      });
    }
    // @__NO_SIDE_EFFECTS__
    function _custom(Class, fn, _params) {
      const norm = util2.normalizeParams(_params);
      norm.abort ?? (norm.abort = true);
      const schema = new Class({
        type: "custom",
        check: "custom",
        fn,
        ...norm
      });
      return schema;
    }
    // @__NO_SIDE_EFFECTS__
    function _refine(Class, fn, _params) {
      const schema = new Class({
        type: "custom",
        check: "custom",
        fn,
        ...util2.normalizeParams(_params)
      });
      return schema;
    }
    // @__NO_SIDE_EFFECTS__
    function _superRefine(fn, params) {
      const ch = /* @__PURE__ */ _check((payload) => {
        payload.addIssue = (issue) => {
          if (typeof issue === "string") {
            payload.issues.push(util2.issue(issue, payload.value, ch._zod.def));
          } else {
            const _issue = issue;
            if (_issue.fatal)
              _issue.continue = false;
            _issue.code ?? (_issue.code = "custom");
            if (!("input" in _issue))
              _issue.input = payload.value;
            _issue.inst ?? (_issue.inst = ch);
            _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
            payload.issues.push(util2.issue(_issue));
          }
        };
        return fn(payload.value, payload);
      }, params);
      return ch;
    }
    // @__NO_SIDE_EFFECTS__
    function _check(fn, params) {
      const ch = new checks2.$ZodCheck({
        check: "custom",
        ...util2.normalizeParams(params)
      });
      ch._zod.check = fn;
      return ch;
    }
    // @__NO_SIDE_EFFECTS__
    function describe(description) {
      const ch = new checks2.$ZodCheck({ check: "describe" });
      ch._zod.onattach = [
        (inst) => {
          const existing = registries2.globalRegistry.get(inst) ?? {};
          registries2.globalRegistry.add(inst, { ...existing, description });
        }
      ];
      ch._zod.check = () => {
      };
      return ch;
    }
    // @__NO_SIDE_EFFECTS__
    function meta(metadata) {
      const ch = new checks2.$ZodCheck({ check: "meta" });
      ch._zod.onattach = [
        (inst) => {
          const existing = registries2.globalRegistry.get(inst) ?? {};
          registries2.globalRegistry.add(inst, { ...existing, ...metadata });
        }
      ];
      ch._zod.check = () => {
      };
      return ch;
    }
    // @__NO_SIDE_EFFECTS__
    function _stringbool(Classes, _params) {
      const params = util2.normalizeParams(_params);
      let truthyArray = params.truthy ?? ["true", "1", "yes", "on", "y", "enabled"];
      let falsyArray = params.falsy ?? ["false", "0", "no", "off", "n", "disabled"];
      if (params.case !== "sensitive") {
        truthyArray = truthyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
        falsyArray = falsyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
      }
      const truthySet = new Set(truthyArray);
      const falsySet = new Set(falsyArray);
      const _Codec = Classes.Codec ?? schemas2.$ZodCodec;
      const _Boolean = Classes.Boolean ?? schemas2.$ZodBoolean;
      const _String = Classes.String ?? schemas2.$ZodString;
      const stringSchema = new _String({ type: "string", error: params.error });
      const booleanSchema = new _Boolean({ type: "boolean", error: params.error });
      const codec = new _Codec({
        type: "pipe",
        in: stringSchema,
        out: booleanSchema,
        transform: ((input, payload) => {
          let data2 = input;
          if (params.case !== "sensitive")
            data2 = data2.toLowerCase();
          if (truthySet.has(data2)) {
            return true;
          } else if (falsySet.has(data2)) {
            return false;
          } else {
            payload.issues.push({
              code: "invalid_value",
              expected: "stringbool",
              values: [...truthySet, ...falsySet],
              input: payload.value,
              inst: codec,
              continue: false
            });
            return {};
          }
        }),
        reverseTransform: ((input, _payload) => {
          if (input === true) {
            return truthyArray[0] || "true";
          } else {
            return falsyArray[0] || "false";
          }
        }),
        error: params.error
      });
      codec._zod.bag.truthy = truthyArray;
      codec._zod.bag.falsy = falsyArray;
      codec._zod.bag.case = params.case ?? "insensitive";
      return codec;
    }
    // @__NO_SIDE_EFFECTS__
    function _stringFormat(Class, format, fnOrRegex, _params = {}) {
      const params = util2.normalizeParams(_params);
      const def = {
        check: "string_format",
        type: "string",
        format,
        fn: typeof fnOrRegex === "function" ? fnOrRegex : (val) => fnOrRegex.test(val),
        ...params
      };
      if (fnOrRegex instanceof RegExp) {
        def.pattern = fnOrRegex;
      }
      const inst = new Class(def);
      return inst;
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(api$1);
  return api$1;
}
var toJsonSchema = {};
var hasRequiredToJsonSchema;
function requireToJsonSchema() {
  if (hasRequiredToJsonSchema) return toJsonSchema;
  hasRequiredToJsonSchema = 1;
  (function(exports2) {
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.createStandardJSONSchemaMethod = exports2.createToJSONSchemaMethod = void 0;
    exports2.initializeContext = initializeContext;
    exports2.handleUnrepresentable = handleUnrepresentable;
    exports2.processSchema = processSchema;
    exports2.process = processSchema;
    exports2.processSchema = processSchema;
    exports2.process = processSchema;
    exports2.extractDefs = extractDefs;
    exports2.finalize = finalize;
    const registries_js_1 = /* @__PURE__ */ requireRegistries();
    const util_js_1 = /* @__PURE__ */ requireUtil();
    function assignProps(target, ...sources) {
      for (const source of sources) {
        for (const key of Reflect.ownKeys(source)) {
          if (Object.prototype.propertyIsEnumerable.call(source, key)) {
            (0, util_js_1.assignProp)(target, key, source[key]);
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
        metadataRegistry: params?.metadata ?? registries_js_1.globalRegistry,
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
      var _a;
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
        (_a = result.schema).default ?? (_a.default = result.schema._prefault);
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
        const { ref, defId } = makeURI(entry);
        seen.def = { ...seen.schema };
        if (defId)
          seen.defId = defId;
        const schema2 = seen.schema;
        for (const key in schema2) {
          delete schema2[key];
        }
        schema2.$ref = ref;
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
        const keys = Object.keys(option);
        if (keys.length !== 1 || keys[0] !== "type")
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
    function foldObjects(members) {
      const objects = [];
      for (const member of members) {
        if (typeof member !== "object" || member.type !== "object")
          return null;
        for (const key in member) {
          if (!FOLDABLE_KEYS.has(key))
            return null;
        }
        objects.push(member);
      }
      const properties = {};
      const required = /* @__PURE__ */ new Set();
      for (const object of objects) {
        for (const key in object.properties) {
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
          (0, util_js_1.assignProp)(properties, key, merged);
        }
        for (const key of object.required ?? [])
          required.add(key);
      }
      const folded = { type: "object", properties };
      if (required.size)
        folded.required = [...required];
      if (objects.every((object) => object.additionalProperties === false)) {
        folded.additionalProperties = false;
      } else {
        const constraints = [];
        for (const object of objects) {
          const constraint = undeclaredConstraint(object);
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
        const union = unions[0];
        const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
        if (Object.keys(union).length !== 1)
          return;
        const rest = allOf.filter((m) => m !== union);
        const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
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
        const ref = seen.ref;
        seen.ref = null;
        if (ref) {
          flattenRef(ref);
          const refSeen = ctx.seen.get(ref);
          const refSchema = refSeen.schema;
          if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
            schema2.allOf = schema2.allOf ?? [];
            schema2.allOf.push(refSchema);
          } else {
            assignProps(schema2, refSchema);
          }
          assignProps(schema2, _cached);
          const isParentRef = zodSchema._zod.parent === ref;
          if (isParentRef) {
            for (const key in schema2) {
              if (key === "$ref" || key === "allOf")
                continue;
              if (!(key in _cached)) {
                delete schema2[key];
              }
            }
          }
          if (refSchema.$ref && refSeen.def) {
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
        if (parent && parent !== ref) {
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
            (0, util_js_1.assignProp)(defs, seen.defId, seen.def);
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
              input: (0, exports2.createStandardJSONSchemaMethod)(schema, "input", ctx.processors),
              output: (0, exports2.createStandardJSONSchemaMethod)(schema, "output", ctx.processors)
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
    exports2.createToJSONSchemaMethod = createToJSONSchemaMethod;
    const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
      const { libraryOptions, target } = params ?? {};
      const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
      processSchema(schema, ctx);
      extractDefs(ctx, schema);
      return finalize(ctx, schema);
    };
    exports2.createStandardJSONSchemaMethod = createStandardJSONSchemaMethod;
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(toJsonSchema);
  return toJsonSchema;
}
var jsonSchemaProcessors = {};
var hasRequiredJsonSchemaProcessors;
function requireJsonSchemaProcessors() {
  if (hasRequiredJsonSchemaProcessors) return jsonSchemaProcessors;
  hasRequiredJsonSchemaProcessors = 1;
  (function(exports2) {
    var __createBinding = jsonSchemaProcessors && jsonSchemaProcessors.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = jsonSchemaProcessors && jsonSchemaProcessors.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = jsonSchemaProcessors && jsonSchemaProcessors.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.allProcessors = exports2.lazyProcessor = exports2.optionalProcessor = exports2.promiseProcessor = exports2.readonlyProcessor = exports2.pipeProcessor = exports2.catchProcessor = exports2.prefaultProcessor = exports2.defaultProcessor = exports2.nonoptionalProcessor = exports2.nullableProcessor = exports2.recordProcessor = exports2.tupleProcessor = exports2.intersectionProcessor = exports2.unionProcessor = exports2.objectProcessor = exports2.arrayProcessor = exports2.setProcessor = exports2.mapProcessor = exports2.transformProcessor = exports2.functionProcessor = exports2.customProcessor = exports2.successProcessor = exports2.fileProcessor = exports2.templateLiteralProcessor = exports2.nanProcessor = exports2.literalProcessor = exports2.enumProcessor = exports2.dateProcessor = exports2.unknownProcessor = exports2.anyProcessor = exports2.neverProcessor = exports2.voidProcessor = exports2.undefinedProcessor = exports2.nullProcessor = exports2.symbolProcessor = exports2.bigintProcessor = exports2.booleanProcessor = exports2.numberProcessor = exports2.stringProcessor = void 0;
    exports2.aggregateChecks = aggregateChecks;
    exports2.toJSONSchema = toJSONSchema;
    const regexes2 = __importStar(/* @__PURE__ */ requireRegexes());
    const schemas_js_1 = /* @__PURE__ */ requireSchemas$1();
    const to_json_schema_js_1 = /* @__PURE__ */ requireToJsonSchema();
    const util_js_1 = /* @__PURE__ */ requireUtil();
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
      number_format: formatContributor(util_js_1.NUMBER_FORMAT_RANGES),
      bigint_format: formatContributor(util_js_1.BIGINT_FORMAT_RANGES),
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
      [schemas_js_1.base64Charset, regexes2.base64],
      [schemas_js_1.base64urlCharset, regexes2.base64url]
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
    exports2.stringProcessor = stringProcessor;
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
            (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
        }
        const [first, ...rest] = divisors;
        if (first !== void 0)
          json.multipleOf = first;
        if (rest.length)
          json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
      }
    };
    exports2.numberProcessor = numberProcessor;
    const booleanProcessor = (_schema, _ctx, json, _params) => {
      json.type = "boolean";
    };
    exports2.booleanProcessor = booleanProcessor;
    const bigintProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "BigInt cannot be represented in JSON Schema");
    };
    exports2.bigintProcessor = bigintProcessor;
    const symbolProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Symbols cannot be represented in JSON Schema");
    };
    exports2.symbolProcessor = symbolProcessor;
    const nullProcessor = (_schema, ctx, json, _params) => {
      if (ctx.target === "openapi-3.0") {
        json.type = "string";
        json.nullable = true;
        json.enum = [null];
      } else {
        json.type = "null";
      }
    };
    exports2.nullProcessor = nullProcessor;
    const undefinedProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Undefined cannot be represented in JSON Schema");
    };
    exports2.undefinedProcessor = undefinedProcessor;
    const voidProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Void cannot be represented in JSON Schema");
    };
    exports2.voidProcessor = voidProcessor;
    const neverProcessor = (_schema, _ctx, json, _params) => {
      json.not = {};
    };
    exports2.neverProcessor = neverProcessor;
    const anyProcessor = (_schema, _ctx, _json, _params) => {
    };
    exports2.anyProcessor = anyProcessor;
    const unknownProcessor = (_schema, _ctx, _json, _params) => {
    };
    exports2.unknownProcessor = unknownProcessor;
    const dateProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Date cannot be represented in JSON Schema");
    };
    exports2.dateProcessor = dateProcessor;
    const enumProcessor = (schema, _ctx, json, _params) => {
      const def = schema._zod.def;
      const values = (0, util_js_1.getEnumValues)(def.entries);
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
    exports2.enumProcessor = enumProcessor;
    const literalProcessor = (schema, ctx, json, params) => {
      const def = schema._zod.def;
      if (def.values.length === 0) {
        json.not = {};
        return;
      }
      const vals = [];
      for (const val of def.values) {
        if (val === void 0) {
          if ((0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
            return;
        } else if (typeof val === "bigint") {
          if ((0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
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
    exports2.literalProcessor = literalProcessor;
    const nanProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "NaN cannot be represented in JSON Schema");
    };
    exports2.nanProcessor = nanProcessor;
    const templateLiteralProcessor = (schema, _ctx, json, _params) => {
      const _json = json;
      const pattern = schema._zod.pattern;
      if (!pattern)
        throw new Error("Pattern not found in template literal");
      _json.type = "string";
      _json.pattern = pattern.source;
    };
    exports2.templateLiteralProcessor = templateLiteralProcessor;
    const fileProcessor = (schema, _ctx, json, _params) => {
      const _json = json;
      _json.type = "string";
      _json.format = "binary";
      _json.contentEncoding = "binary";
      const { minimum, maximum, mime } = aggregateChecks(schema);
      if (minimum !== void 0)
        _json.minLength = minimum;
      if (maximum !== void 0)
        _json.maxLength = maximum;
      if (!mime)
        return;
      if (mime.length === 0)
        _json.not = {};
      else if (mime.length === 1)
        _json.contentMediaType = mime[0];
      else
        _json.anyOf = mime.map((m) => ({ contentMediaType: m }));
    };
    exports2.fileProcessor = fileProcessor;
    const successProcessor = (_schema, _ctx, json, _params) => {
      json.type = "boolean";
    };
    exports2.successProcessor = successProcessor;
    const customProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
    };
    exports2.customProcessor = customProcessor;
    const functionProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Function types cannot be represented in JSON Schema");
    };
    exports2.functionProcessor = functionProcessor;
    const transformProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
    };
    exports2.transformProcessor = transformProcessor;
    const mapProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Map cannot be represented in JSON Schema");
    };
    exports2.mapProcessor = mapProcessor;
    const setProcessor = (schema, ctx, json, params) => {
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Set cannot be represented in JSON Schema");
    };
    exports2.setProcessor = setProcessor;
    const arrayProcessor = (schema, ctx, _json, params) => {
      const json = _json;
      const def = schema._zod.def;
      const { minimum, maximum } = aggregateChecks(schema);
      if (typeof minimum === "number")
        json.minItems = minimum;
      if (typeof maximum === "number")
        json.maxItems = maximum;
      json.type = "array";
      json.items = (0, to_json_schema_js_1.processSchema)(def.element, ctx, {
        ...params,
        path: [...params.path, "items"]
      });
    };
    exports2.arrayProcessor = arrayProcessor;
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
      if (symbolKeys.length && (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
        return;
      }
      json.type = "object";
      json.properties = {};
      for (const key in shape) {
        (0, util_js_1.assignProp)(json.properties, key, (0, to_json_schema_js_1.processSchema)(shape[key], ctx, {
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
        json.additionalProperties = (0, to_json_schema_js_1.processSchema)(def.catchall, ctx, {
          ...params,
          path: [...params.path, "additionalProperties"]
        });
      }
    };
    exports2.objectProcessor = objectProcessor;
    const unionProcessor = (schema, ctx, json, params) => {
      const def = schema._zod.def;
      const isExclusive = def.inclusive === false;
      const options = def.options.map((x, i) => (0, to_json_schema_js_1.processSchema)(x, ctx, {
        ...params,
        path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
      }));
      if (isExclusive) {
        json.oneOf = options;
      } else {
        json.anyOf = options;
      }
    };
    exports2.unionProcessor = unionProcessor;
    const intersectionProcessor = (schema, ctx, json, params) => {
      const def = schema._zod.def;
      const a = (0, to_json_schema_js_1.processSchema)(def.left, ctx, {
        ...params,
        path: [...params.path, "allOf", 0]
      });
      const b = (0, to_json_schema_js_1.processSchema)(def.right, ctx, {
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
    exports2.intersectionProcessor = intersectionProcessor;
    const tupleProcessor = (schema, ctx, _json, params) => {
      const json = _json;
      const def = schema._zod.def;
      json.type = "array";
      const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
      const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
      const prefixItems = def.items.map((x, i) => (0, to_json_schema_js_1.processSchema)(x, ctx, {
        ...params,
        path: [...params.path, prefixPath, i]
      }));
      const rest = def.rest ? (0, to_json_schema_js_1.processSchema)(def.rest, ctx, {
        ...params,
        path: [...params.path, restPath, ...ctx.target === "openapi-3.0" ? [def.items.length] : []]
      }) : null;
      let minItems = def.items.length;
      while (minItems > 0) {
        const item = def.items[minItems - 1];
        const optional = ctx.io === "input" ? inputOptin(item) !== void 0 : item._zod.optout === "optional";
        if (!optional)
          break;
        minItems--;
      }
      const maxItems = def.items.length;
      const isClosed = !def.rest;
      if (ctx.target === "draft-2020-12") {
        json.prefixItems = prefixItems;
        if (isClosed) {
          json.items = false;
        } else if (rest) {
          json.items = rest;
        }
        if (minItems > 0)
          json.minItems = minItems;
        if (isClosed)
          json.maxItems = maxItems;
      } else if (ctx.target === "openapi-3.0") {
        json.items = {
          anyOf: prefixItems
        };
        if (rest) {
          json.items.anyOf.push(rest);
        }
        if (minItems > 0)
          json.minItems = minItems;
        if (isClosed)
          json.maxItems = maxItems;
      } else {
        json.items = prefixItems;
        if (isClosed) {
          json.additionalItems = false;
        } else if (rest) {
          json.additionalItems = rest;
        }
        if (minItems > 0)
          json.minItems = minItems;
        if (isClosed)
          json.maxItems = maxItems;
      }
      const { minimum, maximum } = aggregateChecks(schema);
      if (typeof minimum === "number")
        json.minItems = minimum;
      if (typeof maximum === "number")
        json.maxItems = maximum;
    };
    exports2.tupleProcessor = tupleProcessor;
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
        rest.pattern = (types.includes("number") ? regexes2.number : regexes2.integer).source;
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
      for (const record of pendingRecords.get(ctx) ?? []) {
        const seen = ctx.seen.get(record);
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
        const valueSchema = (0, to_json_schema_js_1.processSchema)(def.valueType, ctx, {
          ...params,
          path: [...params.path, "patternProperties", "*"]
        });
        json.patternProperties = {};
        for (const pattern of patterns) {
          (0, util_js_1.assignProp)(json.patternProperties, exactPattern(pattern).source, valueSchema);
        }
      } else {
        if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
          json.propertyNames = (0, to_json_schema_js_1.processSchema)(def.keyType, ctx, {
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
        json.additionalProperties = (0, to_json_schema_js_1.processSchema)(def.valueType, ctx, {
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
    exports2.recordProcessor = recordProcessor;
    const nullableProcessor = (schema, ctx, json, params) => {
      const def = schema._zod.def;
      const inner = (0, to_json_schema_js_1.processSchema)(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      if (ctx.target === "openapi-3.0") {
        seen.ref = def.innerType;
        json.nullable = true;
      } else {
        json.anyOf = [inner, { type: "null" }];
      }
    };
    exports2.nullableProcessor = nullableProcessor;
    const nonoptionalProcessor = (schema, ctx, _json, params) => {
      const def = schema._zod.def;
      (0, to_json_schema_js_1.processSchema)(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
    };
    exports2.nonoptionalProcessor = nonoptionalProcessor;
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
      (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
      return UNREPRESENTABLE_DEFAULT;
    }
    const defaultProcessor = (schema, ctx, json, params) => {
      const def = schema._zod.def;
      (0, to_json_schema_js_1.processSchema)(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
      const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
      if (value !== UNREPRESENTABLE_DEFAULT)
        json.default = value;
    };
    exports2.defaultProcessor = defaultProcessor;
    const prefaultProcessor = (schema, ctx, json, params) => {
      const def = schema._zod.def;
      (0, to_json_schema_js_1.processSchema)(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
      if (ctx.io !== "input")
        return;
      const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
      if (value !== UNREPRESENTABLE_DEFAULT)
        json._prefault = value;
    };
    exports2.prefaultProcessor = prefaultProcessor;
    const catchProcessor = (schema, ctx, json, params) => {
      const def = schema._zod.def;
      (0, to_json_schema_js_1.processSchema)(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
      let catchValue;
      try {
        catchValue = def.catchValue(void 0);
      } catch {
        (0, to_json_schema_js_1.handleUnrepresentable)(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
        return;
      }
      json.default = catchValue;
    };
    exports2.catchProcessor = catchProcessor;
    const pipeProcessor = (schema, ctx, _json, params) => {
      const def = schema._zod.def;
      const inIsTransform = def.in._zod.traits.has("$ZodTransform");
      const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
      (0, to_json_schema_js_1.processSchema)(innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = innerType;
    };
    exports2.pipeProcessor = pipeProcessor;
    const readonlyProcessor = (schema, ctx, json, params) => {
      const def = schema._zod.def;
      (0, to_json_schema_js_1.processSchema)(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
      json.readOnly = true;
    };
    exports2.readonlyProcessor = readonlyProcessor;
    const promiseProcessor = (schema, ctx, _json, params) => {
      const def = schema._zod.def;
      (0, to_json_schema_js_1.processSchema)(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
    };
    exports2.promiseProcessor = promiseProcessor;
    const optionalProcessor = (schema, ctx, _json, params) => {
      const def = schema._zod.def;
      (0, to_json_schema_js_1.processSchema)(def.innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = def.innerType;
    };
    exports2.optionalProcessor = optionalProcessor;
    const lazyProcessor = (schema, ctx, _json, params) => {
      const innerType = schema._zod.innerType;
      (0, to_json_schema_js_1.processSchema)(innerType, ctx, params);
      const seen = ctx.seen.get(schema);
      seen.ref = innerType;
    };
    exports2.lazyProcessor = lazyProcessor;
    exports2.allProcessors = {
      string: exports2.stringProcessor,
      number: exports2.numberProcessor,
      boolean: exports2.booleanProcessor,
      bigint: exports2.bigintProcessor,
      symbol: exports2.symbolProcessor,
      null: exports2.nullProcessor,
      undefined: exports2.undefinedProcessor,
      void: exports2.voidProcessor,
      never: exports2.neverProcessor,
      any: exports2.anyProcessor,
      unknown: exports2.unknownProcessor,
      date: exports2.dateProcessor,
      enum: exports2.enumProcessor,
      literal: exports2.literalProcessor,
      nan: exports2.nanProcessor,
      template_literal: exports2.templateLiteralProcessor,
      file: exports2.fileProcessor,
      success: exports2.successProcessor,
      custom: exports2.customProcessor,
      function: exports2.functionProcessor,
      transform: exports2.transformProcessor,
      map: exports2.mapProcessor,
      set: exports2.setProcessor,
      array: exports2.arrayProcessor,
      object: exports2.objectProcessor,
      union: exports2.unionProcessor,
      intersection: exports2.intersectionProcessor,
      tuple: exports2.tupleProcessor,
      record: exports2.recordProcessor,
      nullable: exports2.nullableProcessor,
      nonoptional: exports2.nonoptionalProcessor,
      default: exports2.defaultProcessor,
      prefault: exports2.prefaultProcessor,
      catch: exports2.catchProcessor,
      pipe: exports2.pipeProcessor,
      readonly: exports2.readonlyProcessor,
      promise: exports2.promiseProcessor,
      optional: exports2.optionalProcessor,
      lazy: exports2.lazyProcessor
    };
    function toJSONSchema(input, params) {
      if ("_idmap" in input) {
        const registry = input;
        const ctx2 = (0, to_json_schema_js_1.initializeContext)({ ...params, processors: exports2.allProcessors });
        const defs = {};
        for (const entry of registry._idmap.entries()) {
          const [_, schema] = entry;
          (0, to_json_schema_js_1.processSchema)(schema, ctx2);
        }
        const schemas2 = {};
        const external2 = {
          registry,
          uri: params?.uri,
          defs
        };
        ctx2.external = external2;
        for (const entry of registry._idmap.entries()) {
          const [key, schema] = entry;
          (0, to_json_schema_js_1.extractDefs)(ctx2, schema);
          (0, util_js_1.assignProp)(schemas2, key, (0, to_json_schema_js_1.finalize)(ctx2, schema));
        }
        if (Object.keys(defs).length > 0) {
          const defsSegment = ctx2.target === "draft-2020-12" ? "$defs" : "definitions";
          schemas2.__shared = {
            [defsSegment]: defs
          };
        }
        return { schemas: schemas2 };
      }
      const ctx = (0, to_json_schema_js_1.initializeContext)({ ...params, processors: exports2.allProcessors });
      (0, to_json_schema_js_1.processSchema)(input, ctx);
      (0, to_json_schema_js_1.extractDefs)(ctx, input);
      return (0, to_json_schema_js_1.finalize)(ctx, input);
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(jsonSchemaProcessors);
  return jsonSchemaProcessors;
}
var jsonSchemaGenerator = {};
var hasRequiredJsonSchemaGenerator;
function requireJsonSchemaGenerator() {
  if (hasRequiredJsonSchemaGenerator) return jsonSchemaGenerator;
  hasRequiredJsonSchemaGenerator = 1;
  (function(exports2) {
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.JSONSchemaGenerator = void 0;
    const json_schema_processors_js_1 = /* @__PURE__ */ requireJsonSchemaProcessors();
    const to_json_schema_js_1 = /* @__PURE__ */ requireToJsonSchema();
    class JSONSchemaGenerator {
      /** @deprecated Access via ctx instead */
      get metadataRegistry() {
        return this.ctx.metadataRegistry;
      }
      /** @deprecated Access via ctx instead */
      get target() {
        return this.ctx.target;
      }
      // annotated so the .d.cts emits an indexed access rather than an inline `import()` of an ESM path
      /** @deprecated Access via ctx instead */
      get unrepresentable() {
        return this.ctx.unrepresentable;
      }
      /** @deprecated Access via ctx instead */
      get override() {
        return this.ctx.override;
      }
      /** @deprecated Access via ctx instead */
      get io() {
        return this.ctx.io;
      }
      /** @deprecated Access via ctx instead */
      get counter() {
        return this.ctx.counter;
      }
      set counter(value) {
        this.ctx.counter = value;
      }
      /** @deprecated Access via ctx instead */
      get seen() {
        return this.ctx.seen;
      }
      constructor(params) {
        let normalizedTarget = params?.target ?? "draft-2020-12";
        if (normalizedTarget === "draft-4")
          normalizedTarget = "draft-04";
        if (normalizedTarget === "draft-7")
          normalizedTarget = "draft-07";
        this.ctx = (0, to_json_schema_js_1.initializeContext)({
          processors: json_schema_processors_js_1.allProcessors,
          target: normalizedTarget,
          ...params?.metadata && { metadata: params.metadata },
          ...params?.unrepresentable && { unrepresentable: params.unrepresentable },
          ...params?.override && { override: params.override },
          ...params?.io && { io: params.io }
        });
      }
      /**
       * Process a schema to prepare it for JSON Schema generation.
       * This must be called before emit().
       */
      process(schema, _params = { path: [], schemaPath: [] }) {
        return (0, to_json_schema_js_1.processSchema)(schema, this.ctx, _params);
      }
      /**
       * Emit the final JSON Schema after processing.
       * Must call process() first.
       */
      emit(schema, _params) {
        if (_params) {
          if (_params.cycles)
            this.ctx.cycles = _params.cycles;
          if (_params.reused)
            this.ctx.reused = _params.reused;
          if (_params.external)
            this.ctx.external = _params.external;
        }
        this.ctx.sharedDefsExtractedFor = void 0;
        this.ctx.sharedEmitDoneFor = void 0;
        (0, to_json_schema_js_1.extractDefs)(this.ctx, schema);
        const result = (0, to_json_schema_js_1.finalize)(this.ctx, schema);
        const { "~standard": _, ...plainResult } = result;
        return plainResult;
      }
    }
    exports2.JSONSchemaGenerator = JSONSchemaGenerator;
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(jsonSchemaGenerator);
  return jsonSchemaGenerator;
}
var jsonSchema = {};
var hasRequiredJsonSchema;
function requireJsonSchema() {
  if (hasRequiredJsonSchema) return jsonSchema;
  hasRequiredJsonSchema = 1;
  (function(exports2) {
    Object.defineProperty(exports2, "__esModule", { value: true });
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(jsonSchema);
  return jsonSchema;
}
var hasRequiredCore;
function requireCore() {
  if (hasRequiredCore) return core$1;
  hasRequiredCore = 1;
  (function(exports2) {
    var __createBinding = core$1 && core$1.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = core$1 && core$1.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __exportStar = core$1 && core$1.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    var __importStar = core$1 && core$1.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.JSONSchema = exports2.JSONSchemaGenerator = exports2.toJSONSchema = exports2.locales = exports2.regexes = exports2.toZod = exports2.util = void 0;
    __exportStar(/* @__PURE__ */ requireCore$1(), exports2);
    __exportStar(/* @__PURE__ */ requireParse$1(), exports2);
    __exportStar(/* @__PURE__ */ requireErrors$1(), exports2);
    __exportStar(/* @__PURE__ */ requireSchemas$1(), exports2);
    __exportStar(/* @__PURE__ */ requireMemoizer(), exports2);
    __exportStar(/* @__PURE__ */ requireChecks$1(), exports2);
    __exportStar(/* @__PURE__ */ requireVersions(), exports2);
    exports2.util = __importStar(/* @__PURE__ */ requireUtil());
    var util_js_1 = /* @__PURE__ */ requireUtil();
    Object.defineProperty(exports2, "toZod", { enumerable: true, get: function() {
      return util_js_1.toZod;
    } });
    exports2.regexes = __importStar(/* @__PURE__ */ requireRegexes());
    exports2.locales = __importStar(/* @__PURE__ */ requireLocales());
    __exportStar(/* @__PURE__ */ requireRegistries(), exports2);
    __exportStar(/* @__PURE__ */ requireDoc(), exports2);
    __exportStar(/* @__PURE__ */ requireCompile(), exports2);
    __exportStar(/* @__PURE__ */ requireApi(), exports2);
    __exportStar(/* @__PURE__ */ requireToJsonSchema(), exports2);
    var json_schema_processors_js_1 = /* @__PURE__ */ requireJsonSchemaProcessors();
    Object.defineProperty(exports2, "toJSONSchema", { enumerable: true, get: function() {
      return json_schema_processors_js_1.toJSONSchema;
    } });
    var json_schema_generator_js_1 = /* @__PURE__ */ requireJsonSchemaGenerator();
    Object.defineProperty(exports2, "JSONSchemaGenerator", { enumerable: true, get: function() {
      return json_schema_generator_js_1.JSONSchemaGenerator;
    } });
    exports2.JSONSchema = __importStar(/* @__PURE__ */ requireJsonSchema());
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(core$1);
  return core$1;
}
var schemas = {};
var checks = {};
var hasRequiredChecks;
function requireChecks() {
  if (hasRequiredChecks) return checks;
  hasRequiredChecks = 1;
  (function(exports2) {
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.slugify = exports2.toUpperCase = exports2.toLowerCase = exports2.trim = exports2.normalize = exports2.overwrite = exports2.mime = exports2.properties = exports2.property = exports2.endsWith = exports2.startsWith = exports2.includes = exports2.uppercase = exports2.lowercase = exports2.regex = exports2.length = exports2.minLength = exports2.maxLength = exports2.size = exports2.minSize = exports2.maxSize = exports2.multipleOf = exports2.nonnegative = exports2.nonpositive = exports2.negative = exports2.positive = exports2.gte = exports2.gt = exports2.lte = exports2.lt = void 0;
    var index_js_1 = /* @__PURE__ */ requireCore();
    Object.defineProperty(exports2, "lt", { enumerable: true, get: function() {
      return index_js_1._lt;
    } });
    Object.defineProperty(exports2, "lte", { enumerable: true, get: function() {
      return index_js_1._lte;
    } });
    Object.defineProperty(exports2, "gt", { enumerable: true, get: function() {
      return index_js_1._gt;
    } });
    Object.defineProperty(exports2, "gte", { enumerable: true, get: function() {
      return index_js_1._gte;
    } });
    Object.defineProperty(exports2, "positive", { enumerable: true, get: function() {
      return index_js_1._positive;
    } });
    Object.defineProperty(exports2, "negative", { enumerable: true, get: function() {
      return index_js_1._negative;
    } });
    Object.defineProperty(exports2, "nonpositive", { enumerable: true, get: function() {
      return index_js_1._nonpositive;
    } });
    Object.defineProperty(exports2, "nonnegative", { enumerable: true, get: function() {
      return index_js_1._nonnegative;
    } });
    Object.defineProperty(exports2, "multipleOf", { enumerable: true, get: function() {
      return index_js_1._multipleOf;
    } });
    Object.defineProperty(exports2, "maxSize", { enumerable: true, get: function() {
      return index_js_1._maxSize;
    } });
    Object.defineProperty(exports2, "minSize", { enumerable: true, get: function() {
      return index_js_1._minSize;
    } });
    Object.defineProperty(exports2, "size", { enumerable: true, get: function() {
      return index_js_1._size;
    } });
    Object.defineProperty(exports2, "maxLength", { enumerable: true, get: function() {
      return index_js_1._maxLength;
    } });
    Object.defineProperty(exports2, "minLength", { enumerable: true, get: function() {
      return index_js_1._minLength;
    } });
    Object.defineProperty(exports2, "length", { enumerable: true, get: function() {
      return index_js_1._length;
    } });
    Object.defineProperty(exports2, "regex", { enumerable: true, get: function() {
      return index_js_1._regex;
    } });
    Object.defineProperty(exports2, "lowercase", { enumerable: true, get: function() {
      return index_js_1._lowercase;
    } });
    Object.defineProperty(exports2, "uppercase", { enumerable: true, get: function() {
      return index_js_1._uppercase;
    } });
    Object.defineProperty(exports2, "includes", { enumerable: true, get: function() {
      return index_js_1._includes;
    } });
    Object.defineProperty(exports2, "startsWith", { enumerable: true, get: function() {
      return index_js_1._startsWith;
    } });
    Object.defineProperty(exports2, "endsWith", { enumerable: true, get: function() {
      return index_js_1._endsWith;
    } });
    Object.defineProperty(exports2, "property", { enumerable: true, get: function() {
      return index_js_1._property;
    } });
    Object.defineProperty(exports2, "properties", { enumerable: true, get: function() {
      return index_js_1._properties;
    } });
    Object.defineProperty(exports2, "mime", { enumerable: true, get: function() {
      return index_js_1._mime;
    } });
    Object.defineProperty(exports2, "overwrite", { enumerable: true, get: function() {
      return index_js_1._overwrite;
    } });
    Object.defineProperty(exports2, "normalize", { enumerable: true, get: function() {
      return index_js_1._normalize;
    } });
    Object.defineProperty(exports2, "trim", { enumerable: true, get: function() {
      return index_js_1._trim;
    } });
    Object.defineProperty(exports2, "toLowerCase", { enumerable: true, get: function() {
      return index_js_1._toLowerCase;
    } });
    Object.defineProperty(exports2, "toUpperCase", { enumerable: true, get: function() {
      return index_js_1._toUpperCase;
    } });
    Object.defineProperty(exports2, "slugify", { enumerable: true, get: function() {
      return index_js_1._slugify;
    } });
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(checks);
  return checks;
}
var parse = {};
var errors = {};
var hasRequiredErrors;
function requireErrors() {
  if (hasRequiredErrors) return errors;
  hasRequiredErrors = 1;
  (function(exports2) {
    var __createBinding = errors && errors.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = errors && errors.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = errors && errors.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ZodRealError = exports2.ZodError = void 0;
    const core2 = __importStar(/* @__PURE__ */ requireCore());
    const index_js_1 = /* @__PURE__ */ requireCore();
    const util2 = __importStar(/* @__PURE__ */ requireUtil());
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
      index_js_1.$ZodError.init(inst, issues);
      inst.name = "ZodError";
      const proto = Object.getPrototypeOf(inst);
      if (_installedErrorProtos.has(proto))
        return;
      _installedErrorProtos.add(proto);
      _lazyMethod(proto, "format", (self) => (mapper) => core2.formatError(self, mapper));
      _lazyMethod(proto, "flatten", (self) => (mapper) => core2.flattenError(self, mapper));
      _lazyMethod(proto, "addIssue", (self) => (issue) => {
        self.issues.push(issue);
        self.message = JSON.stringify(self.issues, util2.jsonStringifyReplacer, 2);
      });
      _lazyMethod(proto, "addIssues", (self) => (issues2) => {
        self.issues.push(...issues2);
        self.message = JSON.stringify(self.issues, util2.jsonStringifyReplacer, 2);
      });
      Object.defineProperty(proto, "isEmpty", {
        configurable: true,
        enumerable: false,
        get() {
          return this.issues.length === 0;
        }
      });
    };
    exports2.ZodError = core2.$constructor("ZodError", initializer);
    exports2.ZodRealError = core2.$constructor("ZodError", initializer, void 0, {
      Parent: Error
    });
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(errors);
  return errors;
}
var hasRequiredParse;
function requireParse() {
  if (hasRequiredParse) return parse;
  hasRequiredParse = 1;
  (function(exports2) {
    var __createBinding = parse && parse.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = parse && parse.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = parse && parse.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.safeDecodeAsync = exports2.safeEncodeAsync = exports2.safeDecode = exports2.safeEncode = exports2.decodeAsync = exports2.encodeAsync = exports2.decode = exports2.encode = exports2.validateAsync = exports2.validate = exports2.safeParseAsync = exports2.safeParse = exports2.parseAsync = exports2.parse = void 0;
    const core2 = __importStar(/* @__PURE__ */ requireCore());
    const errors_js_1 = /* @__PURE__ */ requireErrors();
    exports2.parse = core2._parse(errors_js_1.ZodRealError);
    exports2.parseAsync = core2._parseAsync(errors_js_1.ZodRealError);
    exports2.safeParse = core2._safeParse(errors_js_1.ZodRealError);
    exports2.safeParseAsync = core2._safeParseAsync(errors_js_1.ZodRealError);
    var index_js_1 = /* @__PURE__ */ requireCore();
    Object.defineProperty(exports2, "validate", { enumerable: true, get: function() {
      return index_js_1.validate;
    } });
    Object.defineProperty(exports2, "validateAsync", { enumerable: true, get: function() {
      return index_js_1.validateAsync;
    } });
    exports2.encode = core2._encode(errors_js_1.ZodRealError);
    exports2.decode = core2._decode(errors_js_1.ZodRealError);
    exports2.encodeAsync = core2._encodeAsync(errors_js_1.ZodRealError);
    exports2.decodeAsync = core2._decodeAsync(errors_js_1.ZodRealError);
    exports2.safeEncode = core2._safeEncode(errors_js_1.ZodRealError);
    exports2.safeDecode = core2._safeDecode(errors_js_1.ZodRealError);
    exports2.safeEncodeAsync = core2._safeEncodeAsync(errors_js_1.ZodRealError);
    exports2.safeDecodeAsync = core2._safeDecodeAsync(errors_js_1.ZodRealError);
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(parse);
  return parse;
}
var hasRequiredSchemas;
function requireSchemas() {
  if (hasRequiredSchemas) return schemas;
  hasRequiredSchemas = 1;
  (function(exports2) {
    var __createBinding = schemas && schemas.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = schemas && schemas.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = schemas && schemas.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __importDefault = schemas && schemas.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ZodIntersection = exports2.ZodDiscriminatedUnion = exports2.ZodXor = exports2.ZodUnion = exports2.ZodObject = exports2.ZodArray = exports2.ZodDate = exports2.ZodVoid = exports2.ZodNever = exports2.ZodUnknown = exports2.ZodAny = exports2.ZodNull = exports2.ZodUndefined = exports2.ZodSymbol = exports2.ZodBigIntFormat = exports2.ZodBigInt = exports2.ZodBoolean = exports2.ZodNumberFormat = exports2.ZodNumber = exports2.ZodCustomStringFormat = exports2.ZodJWT = exports2.ZodIBAN = exports2.ZodCreditCard = exports2.ZodE164 = exports2.ZodBase64URL = exports2.ZodBase64 = exports2.ZodCIDRv6 = exports2.ZodCIDRv4 = exports2.ZodIPv6 = exports2.ZodMAC = exports2.ZodIPv4 = exports2.ZodKSUID = exports2.ZodXID = exports2.ZodULID = exports2.ZodCUID2 = exports2.ZodCUID = exports2.ZodNanoID = exports2.ZodEmoji = exports2.ZodURL = exports2.ZodUUID = exports2.ZodGUID = exports2.ZodEmail = exports2.ZodISODuration = exports2.ZodISOTime = exports2.ZodISODate = exports2.ZodISODateTime = exports2.ZodStringFormat = exports2.ZodString = exports2._ZodString = exports2.ZodType = void 0;
    exports2.stringbool = exports2.ZodInstanceOf = exports2.meta = exports2.describe = exports2.ZodCustom = exports2.ZodFunction = exports2.ZodPromise = exports2.ZodLazy = exports2.ZodTemplateLiteral = exports2.ZodReadonly = exports2.ZodPreprocess = exports2.ZodCodec = exports2.ZodPipe = exports2.ZodNaN = exports2.ZodCatch = exports2.ZodSuccess = exports2.ZodNonOptional = exports2.ZodPrefault = exports2.ZodDefault = exports2.ZodNullable = exports2.ZodExactOptional = exports2.ZodOptional = exports2.ZodTransform = exports2.ZodFile = exports2.ZodLiteral = exports2.ZodEnum = exports2.ZodSet = exports2.ZodMap = exports2.ZodRecord = exports2.ZodTuple = void 0;
    exports2.string = string;
    exports2.email = email;
    exports2.guid = guid;
    exports2.uuid = uuid;
    exports2.uuidv4 = uuidv4;
    exports2.uuidv6 = uuidv6;
    exports2.uuidv7 = uuidv7;
    exports2.url = url;
    exports2.httpUrl = httpUrl;
    exports2.emoji = emoji;
    exports2.nanoid = nanoid;
    exports2.cuid = cuid;
    exports2.cuid2 = cuid2;
    exports2.ulid = ulid;
    exports2.xid = xid;
    exports2.ksuid = ksuid;
    exports2.ipv4 = ipv4;
    exports2.mac = mac;
    exports2.ipv6 = ipv6;
    exports2.cidrv4 = cidrv4;
    exports2.cidrv6 = cidrv6;
    exports2.base64 = base64;
    exports2.base64url = base64url;
    exports2.e164 = e164;
    exports2.creditCard = creditCard;
    exports2.iban = iban;
    exports2.jwt = jwt;
    exports2.stringFormat = stringFormat;
    exports2.hostname = hostname;
    exports2.hex = hex;
    exports2.currencyCode = currencyCode;
    exports2.hash = hash2;
    exports2.number = number;
    exports2.int = int;
    exports2.float32 = float32;
    exports2.float64 = float64;
    exports2.int32 = int32;
    exports2.uint32 = uint32;
    exports2.boolean = boolean;
    exports2.bigint = bigint;
    exports2.int64 = int64;
    exports2.uint64 = uint64;
    exports2.symbol = symbol;
    exports2.undefined = _undefined;
    exports2.null = _null;
    exports2.any = any;
    exports2.unknown = unknown;
    exports2.never = never;
    exports2.void = _void;
    exports2.date = date;
    exports2.array = array;
    exports2.keyof = keyof;
    exports2.object = object;
    exports2.strictObject = strictObject;
    exports2.looseObject = looseObject;
    exports2.union = union;
    exports2.xor = xor;
    exports2.discriminatedUnion = discriminatedUnion;
    exports2.intersection = intersection;
    exports2.tuple = tuple;
    exports2.record = record;
    exports2.partialRecord = partialRecord;
    exports2.looseRecord = looseRecord;
    exports2.map = map;
    exports2.set = set;
    exports2.enum = _enum;
    exports2.nativeEnum = nativeEnum;
    exports2.literal = literal;
    exports2.file = file;
    exports2.transform = transform;
    exports2.optional = optional;
    exports2.exactOptional = exactOptional;
    exports2.nullable = nullable;
    exports2.nullish = nullish;
    exports2._default = _default;
    exports2.prefault = prefault;
    exports2.nonoptional = nonoptional;
    exports2.success = success;
    exports2.catch = _catch;
    exports2.nan = nan;
    exports2.pipe = pipe;
    exports2.codec = codec;
    exports2.invertCodec = invertCodec;
    exports2.readonly = readonly;
    exports2.templateLiteral = templateLiteral;
    exports2.lazy = lazy;
    exports2.promise = promise;
    exports2._function = _function;
    exports2.function = _function;
    exports2._function = _function;
    exports2.function = _function;
    exports2.check = check;
    exports2.custom = custom;
    exports2.refine = refine;
    exports2.superRefine = superRefine;
    exports2.instanceof = _instanceof;
    exports2.json = json;
    exports2.preprocess = preprocess;
    const core2 = __importStar(/* @__PURE__ */ requireCore());
    const index_js_1 = /* @__PURE__ */ requireCore();
    const processors = __importStar(/* @__PURE__ */ requireJsonSchemaProcessors());
    const regexes2 = __importStar(/* @__PURE__ */ requireRegexes());
    const to_json_schema_js_1 = /* @__PURE__ */ requireToJsonSchema();
    const en_js_1 = __importDefault(/* @__PURE__ */ requireEn());
    const checks2 = __importStar(/* @__PURE__ */ requireChecks());
    const parse2 = __importStar(/* @__PURE__ */ requireParse());
    function _ensureDefaultLocale() {
      if (!core2.globalConfig.localeError)
        core2.config((0, en_js_1.default)());
    }
    function _ensureDefaultMemoizer() {
      if (!core2.globalConfig.memoizer)
        core2.config({ memoizer: core2.memoizer() });
    }
    exports2.ZodType = core2.$constructor("ZodType", (inst, def) => {
      _ensureDefaultLocale();
      core2.$ZodType.init(inst, def);
      inst.def = def;
      inst.type = def.type;
      return inst;
    }, {
      check(...chks) {
        const def = this.def;
        return this.clone(index_js_1.util.mergeDefs(def, {
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
        return core2.clone(this, def, params);
      },
      brand() {
        return this;
      },
      register(reg, meta) {
        reg.add(this, meta);
        return this;
      },
      refine(check2, params) {
        return this.check(refine(check2, params));
      },
      superRefine(refinement, params) {
        return this.check(superRefine(refinement, params));
      },
      overwrite(fn) {
        return this.check(checks2.overwrite(fn));
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
        return _default(this, d);
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
        core2.globalRegistry.add(cl, { description });
        return cl;
      },
      meta(...args) {
        if (args.length === 0)
          return core2.globalRegistry.get(this);
        const cl = this.clone();
        core2.globalRegistry.add(cl, args[0]);
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
        return index_js_1.util.hide(this, "~standard", {
          ...core2.standardProps(this),
          jsonSchema: {
            input: (0, to_json_schema_js_1.createStandardJSONSchemaMethod)(this, "input"),
            output: (0, to_json_schema_js_1.createStandardJSONSchemaMethod)(this, "output")
          }
        });
      },
      set "~standard"(value) {
        index_js_1.util.own(this, "~standard", value);
      },
      parse: function _parse(data2, params) {
        return parse2.parse(this, data2, params, { callee: _parse });
      },
      parseAsync: async function _parseAsync(data2, params) {
        return await parse2.parseAsync(this, data2, params, { callee: _parseAsync });
      },
      safeParse(data2, params) {
        return parse2.safeParse(this, data2, params);
      },
      async safeParseAsync(data2, params) {
        return parse2.safeParseAsync(this, data2, params);
      },
      // `spa` is an alias: same function object as `safeParseAsync`, as before.
      get spa() {
        return this?.safeParseAsync;
      },
      set spa(value) {
        index_js_1.util.own(this, "spa", value);
      },
      validate(data2, params) {
        return parse2.validate(this, data2, params);
      },
      validateAsync(data2, params) {
        return parse2.validateAsync(this, data2, params);
      },
      encode: function _encode(data2, params) {
        return parse2.encode(this, data2, params, { callee: _encode });
      },
      decode: function _decode(data2, params) {
        return parse2.decode(this, data2, params, { callee: _decode });
      },
      encodeAsync: async function _encodeAsync(data2, params) {
        return await parse2.encodeAsync(this, data2, params, { callee: _encodeAsync });
      },
      decodeAsync: async function _decodeAsync(data2, params) {
        return await parse2.decodeAsync(this, data2, params, { callee: _decodeAsync });
      },
      safeEncode(data2, params) {
        return parse2.safeEncode(this, data2, params);
      },
      safeDecode(data2, params) {
        return parse2.safeDecode(this, data2, params);
      },
      async safeEncodeAsync(data2, params) {
        return parse2.safeEncodeAsync(this, data2, params);
      },
      async safeDecodeAsync(data2, params) {
        return parse2.safeDecodeAsync(this, data2, params);
      },
      toJSONSchema(params) {
        return (0, to_json_schema_js_1.createToJSONSchemaMethod)(this, {})(params);
      },
      // Reads through to the registry on every access, so it must not cache.
      get description() {
        return core2.globalRegistry.get(this)?.description;
      },
      // No setter: `schema._def = x` throws, as it did when `_def` was a non-writable own property.
      get _def() {
        return this._zod.def;
      }
    });
    exports2._ZodString = core2.$constructor(
      "_ZodString",
      (inst, def) => {
        core2.$ZodString.init(inst, def);
        exports2.ZodType.init(inst, def);
        inst._zod.processJSONSchema = (ctx, json2, params) => processors.stringProcessor(inst, ctx, json2, params);
      },
      /* @__PURE__ */ index_js_1.util.derived({
        format: (inst) => processors.aggregateChecks(inst).format ?? null,
        minLength: (inst) => processors.aggregateChecks(inst).minimum ?? null,
        maxLength: (inst) => processors.aggregateChecks(inst).maximum ?? null
      }, {
        regex(...args) {
          return this.check(checks2.regex(...args));
        },
        includes(...args) {
          return this.check(checks2.includes(...args));
        },
        startsWith(...args) {
          return this.check(checks2.startsWith(...args));
        },
        endsWith(...args) {
          return this.check(checks2.endsWith(...args));
        },
        min(...args) {
          return this.check(checks2.minLength(...args));
        },
        max(...args) {
          return this.check(checks2.maxLength(...args));
        },
        length(...args) {
          return this.check(checks2.length(...args));
        },
        nonempty(...args) {
          return this.check(checks2.minLength(1, ...args));
        },
        lowercase(params) {
          return this.check(checks2.lowercase(params));
        },
        uppercase(params) {
          return this.check(checks2.uppercase(params));
        },
        trim() {
          return this.check(checks2.trim());
        },
        normalize(...args) {
          return this.check(checks2.normalize(...args));
        },
        toLowerCase() {
          return this.check(checks2.toLowerCase());
        },
        toUpperCase() {
          return this.check(checks2.toUpperCase());
        },
        slugify() {
          return this.check(checks2.slugify());
        }
      })
    );
    exports2.ZodString = core2.$constructor("ZodString", (inst, def) => {
      core2.$ZodString.init(inst, def);
      exports2._ZodString.init(inst, def);
    }, {
      email(params) {
        return this.check(core2._email(exports2.ZodEmail, params));
      },
      url(params) {
        return this.check(core2._url(exports2.ZodURL, params));
      },
      jwt(params) {
        return this.check(core2._jwt(exports2.ZodJWT, params));
      },
      emoji(params) {
        return this.check(core2._emoji(exports2.ZodEmoji, params));
      },
      guid(params) {
        return this.check(core2._guid(exports2.ZodGUID, params));
      },
      uuid(params) {
        return this.check(core2._uuid(exports2.ZodUUID, params));
      },
      uuidv4(params) {
        return this.check(core2._uuidv4(exports2.ZodUUID, params));
      },
      uuidv6(params) {
        return this.check(core2._uuidv6(exports2.ZodUUID, params));
      },
      uuidv7(params) {
        return this.check(core2._uuidv7(exports2.ZodUUID, params));
      },
      nanoid(params) {
        return this.check(core2._nanoid(exports2.ZodNanoID, params));
      },
      cuid(params) {
        return this.check(core2._cuid(exports2.ZodCUID, params));
      },
      cuid2(params) {
        return this.check(core2._cuid2(exports2.ZodCUID2, params));
      },
      ulid(params) {
        return this.check(core2._ulid(exports2.ZodULID, params));
      },
      base64(params) {
        return this.check(core2._base64(exports2.ZodBase64, params));
      },
      base64url(params) {
        return this.check(core2._base64url(exports2.ZodBase64URL, params));
      },
      xid(params) {
        return this.check(core2._xid(exports2.ZodXID, params));
      },
      ksuid(params) {
        return this.check(core2._ksuid(exports2.ZodKSUID, params));
      },
      ipv4(params) {
        return this.check(core2._ipv4(exports2.ZodIPv4, params));
      },
      ipv6(params) {
        return this.check(core2._ipv6(exports2.ZodIPv6, params));
      },
      cidrv4(params) {
        return this.check(core2._cidrv4(exports2.ZodCIDRv4, params));
      },
      cidrv6(params) {
        return this.check(core2._cidrv6(exports2.ZodCIDRv6, params));
      },
      e164(params) {
        return this.check(core2._e164(exports2.ZodE164, params));
      },
      datetime(params) {
        return this.check(core2._isoDateTime(exports2.ZodISODateTime, params));
      },
      date(params) {
        return this.check(core2._isoDate(exports2.ZodISODate, params));
      },
      time(params) {
        return this.check(core2._isoTime(exports2.ZodISOTime, params));
      },
      duration(params) {
        return this.check(core2._isoDuration(exports2.ZodISODuration, params));
      }
    });
    function string(params) {
      return core2._string(exports2.ZodString, params);
    }
    exports2.ZodStringFormat = core2.$constructor("ZodStringFormat", (inst, def) => {
      core2.$ZodStringFormat.init(inst, def);
      exports2._ZodString.init(inst, def);
    });
    exports2.ZodISODateTime = core2.$constructor("ZodISODateTime", (inst, def) => {
      core2.$ZodISODateTime.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    exports2.ZodISODate = core2.$constructor("ZodISODate", (inst, def) => {
      core2.$ZodISODate.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    exports2.ZodISOTime = core2.$constructor("ZodISOTime", (inst, def) => {
      core2.$ZodISOTime.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    exports2.ZodISODuration = core2.$constructor("ZodISODuration", (inst, def) => {
      core2.$ZodISODuration.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    exports2.ZodEmail = core2.$constructor("ZodEmail", (inst, def) => {
      core2.$ZodEmail.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function email(params) {
      return core2._email(exports2.ZodEmail, params);
    }
    exports2.ZodGUID = core2.$constructor("ZodGUID", (inst, def) => {
      core2.$ZodGUID.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function guid(params) {
      return core2._guid(exports2.ZodGUID, params);
    }
    exports2.ZodUUID = core2.$constructor("ZodUUID", (inst, def) => {
      core2.$ZodUUID.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function uuid(params) {
      return core2._uuid(exports2.ZodUUID, params);
    }
    function uuidv4(params) {
      return core2._uuidv4(exports2.ZodUUID, params);
    }
    function uuidv6(params) {
      return core2._uuidv6(exports2.ZodUUID, params);
    }
    function uuidv7(params) {
      return core2._uuidv7(exports2.ZodUUID, params);
    }
    exports2.ZodURL = core2.$constructor("ZodURL", (inst, def) => {
      core2.$ZodURL.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function url(params) {
      return core2._url(exports2.ZodURL, params);
    }
    function httpUrl(params) {
      return core2._url(exports2.ZodURL, {
        protocol: regexes2.httpProtocol,
        hostname: regexes2.domain,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodEmoji = core2.$constructor("ZodEmoji", (inst, def) => {
      core2.$ZodEmoji.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function emoji(params) {
      return core2._emoji(exports2.ZodEmoji, params);
    }
    exports2.ZodNanoID = core2.$constructor("ZodNanoID", (inst, def) => {
      core2.$ZodNanoID.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function nanoid(params) {
      return core2._nanoid(exports2.ZodNanoID, params);
    }
    exports2.ZodCUID = core2.$constructor("ZodCUID", (inst, def) => {
      core2.$ZodCUID.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function cuid(params) {
      return core2._cuid(exports2.ZodCUID, params);
    }
    exports2.ZodCUID2 = core2.$constructor("ZodCUID2", (inst, def) => {
      core2.$ZodCUID2.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function cuid2(params) {
      return core2._cuid2(exports2.ZodCUID2, params);
    }
    exports2.ZodULID = core2.$constructor("ZodULID", (inst, def) => {
      core2.$ZodULID.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function ulid(params) {
      return core2._ulid(exports2.ZodULID, params);
    }
    exports2.ZodXID = core2.$constructor("ZodXID", (inst, def) => {
      core2.$ZodXID.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function xid(params) {
      return core2._xid(exports2.ZodXID, params);
    }
    exports2.ZodKSUID = core2.$constructor("ZodKSUID", (inst, def) => {
      core2.$ZodKSUID.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function ksuid(params) {
      return core2._ksuid(exports2.ZodKSUID, params);
    }
    exports2.ZodIPv4 = core2.$constructor("ZodIPv4", (inst, def) => {
      core2.$ZodIPv4.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function ipv4(params) {
      return core2._ipv4(exports2.ZodIPv4, params);
    }
    exports2.ZodMAC = core2.$constructor("ZodMAC", (inst, def) => {
      core2.$ZodMAC.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function mac(params) {
      return core2._mac(exports2.ZodMAC, params);
    }
    exports2.ZodIPv6 = core2.$constructor("ZodIPv6", (inst, def) => {
      core2.$ZodIPv6.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function ipv6(params) {
      return core2._ipv6(exports2.ZodIPv6, params);
    }
    exports2.ZodCIDRv4 = core2.$constructor("ZodCIDRv4", (inst, def) => {
      core2.$ZodCIDRv4.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function cidrv4(params) {
      return core2._cidrv4(exports2.ZodCIDRv4, params);
    }
    exports2.ZodCIDRv6 = core2.$constructor("ZodCIDRv6", (inst, def) => {
      core2.$ZodCIDRv6.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function cidrv6(params) {
      return core2._cidrv6(exports2.ZodCIDRv6, params);
    }
    exports2.ZodBase64 = core2.$constructor("ZodBase64", (inst, def) => {
      core2.$ZodBase64.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function base64(params) {
      return core2._base64(exports2.ZodBase64, params);
    }
    exports2.ZodBase64URL = core2.$constructor("ZodBase64URL", (inst, def) => {
      core2.$ZodBase64URL.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function base64url(params) {
      return core2._base64url(exports2.ZodBase64URL, params);
    }
    exports2.ZodE164 = core2.$constructor("ZodE164", (inst, def) => {
      core2.$ZodE164.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function e164(params) {
      return core2._e164(exports2.ZodE164, params);
    }
    exports2.ZodCreditCard = core2.$constructor("ZodCreditCard", (inst, def) => {
      core2.$ZodCreditCard.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function creditCard(params) {
      return core2._creditCard(exports2.ZodCreditCard, params);
    }
    exports2.ZodIBAN = core2.$constructor("ZodIBAN", (inst, def) => {
      core2.$ZodIBAN.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function iban(params) {
      return core2._iban(exports2.ZodIBAN, params);
    }
    exports2.ZodJWT = core2.$constructor("ZodJWT", (inst, def) => {
      core2.$ZodJWT.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function jwt(params) {
      return core2._jwt(exports2.ZodJWT, params);
    }
    exports2.ZodCustomStringFormat = core2.$constructor("ZodCustomStringFormat", (inst, def) => {
      core2.$ZodCustomStringFormat.init(inst, def);
      exports2.ZodStringFormat.init(inst, def);
    });
    function stringFormat(format, fnOrRegex, _params = {}) {
      return core2._stringFormat(exports2.ZodCustomStringFormat, format, fnOrRegex, _params);
    }
    function hostname(_params) {
      return core2._stringFormat(exports2.ZodCustomStringFormat, "hostname", regexes2.hostname, _params);
    }
    function hex(_params) {
      return core2._stringFormat(exports2.ZodCustomStringFormat, "hex", regexes2.hex, _params);
    }
    function currencyCode(_params) {
      return core2._stringFormat(exports2.ZodCustomStringFormat, "currency_code", regexes2.currencyCode, _params);
    }
    function hash2(alg, params) {
      const enc = params?.enc ?? "hex";
      const format = `${alg}_${enc}`;
      const regex = core2.regexes[format];
      if (!regex)
        throw new Error(`Unrecognized hash format: ${format}`);
      return core2._stringFormat(exports2.ZodCustomStringFormat, format, regex, params);
    }
    exports2.ZodNumber = core2.$constructor(
      "ZodNumber",
      (inst, def) => {
        core2.$ZodNumber.init(inst, def);
        exports2.ZodType.init(inst, def);
        inst._zod.processJSONSchema = (ctx, json2, params) => processors.numberProcessor(inst, ctx, json2, params);
        inst.isFinite = true;
      },
      /* @__PURE__ */ index_js_1.util.derived({
        minValue: (inst) => {
          const { minimum, exclusiveMinimum } = processors.aggregateChecks(inst);
          return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
        },
        maxValue: (inst) => {
          const { maximum, exclusiveMaximum } = processors.aggregateChecks(inst);
          return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
        },
        isInt: (inst) => {
          const { isInt, multipleOf } = processors.aggregateChecks(inst);
          return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
        },
        format: (inst) => processors.aggregateChecks(inst).format ?? null
      }, {
        gt(value, params) {
          return this.check(checks2.gt(value, params));
        },
        gte(value, params) {
          return this.check(checks2.gte(value, params));
        },
        min(value, params) {
          return this.check(checks2.gte(value, params));
        },
        lt(value, params) {
          return this.check(checks2.lt(value, params));
        },
        lte(value, params) {
          return this.check(checks2.lte(value, params));
        },
        max(value, params) {
          return this.check(checks2.lte(value, params));
        },
        int(params) {
          return this.check(int(params));
        },
        safe(params) {
          return this.check(int(params));
        },
        positive(params) {
          return this.check(checks2.gt(0, params));
        },
        nonnegative(params) {
          return this.check(checks2.gte(0, params));
        },
        negative(params) {
          return this.check(checks2.lt(0, params));
        },
        nonpositive(params) {
          return this.check(checks2.lte(0, params));
        },
        multipleOf(value, params) {
          return this.check(checks2.multipleOf(value, params));
        },
        step(value, params) {
          return this.check(checks2.multipleOf(value, params));
        },
        finite() {
          return this;
        }
      })
    );
    function number(params) {
      return core2._number(exports2.ZodNumber, params);
    }
    exports2.ZodNumberFormat = core2.$constructor("ZodNumberFormat", (inst, def) => {
      core2.$ZodNumberFormat.init(inst, def);
      exports2.ZodNumber.init(inst, def);
    });
    function int(params) {
      return core2._int(exports2.ZodNumberFormat, params);
    }
    function float32(params) {
      return core2._float32(exports2.ZodNumberFormat, params);
    }
    function float64(params) {
      return core2._float64(exports2.ZodNumberFormat, params);
    }
    function int32(params) {
      return core2._int32(exports2.ZodNumberFormat, params);
    }
    function uint32(params) {
      return core2._uint32(exports2.ZodNumberFormat, params);
    }
    exports2.ZodBoolean = core2.$constructor("ZodBoolean", (inst, def) => {
      core2.$ZodBoolean.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.booleanProcessor(inst, ctx, json2, params);
    });
    function boolean(params) {
      return core2._boolean(exports2.ZodBoolean, params);
    }
    exports2.ZodBigInt = core2.$constructor(
      "ZodBigInt",
      (inst, def) => {
        core2.$ZodBigInt.init(inst, def);
        exports2.ZodType.init(inst, def);
        inst._zod.processJSONSchema = (ctx, json2, params) => processors.bigintProcessor(inst, ctx, json2, params);
      },
      /* @__PURE__ */ index_js_1.util.derived({
        minValue: (inst) => processors.aggregateChecks(inst).minimum ?? null,
        maxValue: (inst) => processors.aggregateChecks(inst).maximum ?? null,
        format: (inst) => processors.aggregateChecks(inst).format ?? null
      }, {
        gte(value, params) {
          return this.check(checks2.gte(value, params));
        },
        min(value, params) {
          return this.check(checks2.gte(value, params));
        },
        gt(value, params) {
          return this.check(checks2.gt(value, params));
        },
        lt(value, params) {
          return this.check(checks2.lt(value, params));
        },
        lte(value, params) {
          return this.check(checks2.lte(value, params));
        },
        max(value, params) {
          return this.check(checks2.lte(value, params));
        },
        positive(params) {
          return this.check(checks2.gt(BigInt(0), params));
        },
        negative(params) {
          return this.check(checks2.lt(BigInt(0), params));
        },
        nonpositive(params) {
          return this.check(checks2.lte(BigInt(0), params));
        },
        nonnegative(params) {
          return this.check(checks2.gte(BigInt(0), params));
        },
        multipleOf(value, params) {
          return this.check(checks2.multipleOf(value, params));
        }
      })
    );
    function bigint(params) {
      return core2._bigint(exports2.ZodBigInt, params);
    }
    exports2.ZodBigIntFormat = core2.$constructor("ZodBigIntFormat", (inst, def) => {
      core2.$ZodBigIntFormat.init(inst, def);
      exports2.ZodBigInt.init(inst, def);
    });
    function int64(params) {
      return core2._int64(exports2.ZodBigIntFormat, params);
    }
    function uint64(params) {
      return core2._uint64(exports2.ZodBigIntFormat, params);
    }
    exports2.ZodSymbol = core2.$constructor("ZodSymbol", (inst, def) => {
      core2.$ZodSymbol.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.symbolProcessor(inst, ctx, json2, params);
    });
    function symbol(params) {
      return core2._symbol(exports2.ZodSymbol, params);
    }
    exports2.ZodUndefined = core2.$constructor("ZodUndefined", (inst, def) => {
      core2.$ZodUndefined.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.undefinedProcessor(inst, ctx, json2, params);
    });
    function _undefined(params) {
      return core2._undefined(exports2.ZodUndefined, params);
    }
    exports2.ZodNull = core2.$constructor("ZodNull", (inst, def) => {
      core2.$ZodNull.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.nullProcessor(inst, ctx, json2, params);
    });
    function _null(params) {
      return core2._null(exports2.ZodNull, params);
    }
    exports2.ZodAny = core2.$constructor("ZodAny", (inst, def) => {
      core2.$ZodAny.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.anyProcessor(inst, ctx, json2, params);
    });
    function any() {
      return core2._any(exports2.ZodAny);
    }
    exports2.ZodUnknown = core2.$constructor("ZodUnknown", (inst, def) => {
      core2.$ZodUnknown.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.unknownProcessor(inst, ctx, json2, params);
    });
    function unknown() {
      return core2._unknown(exports2.ZodUnknown);
    }
    exports2.ZodNever = core2.$constructor("ZodNever", (inst, def) => {
      core2.$ZodNever.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.neverProcessor(inst, ctx, json2, params);
    });
    function never(params) {
      return core2._never(exports2.ZodNever, params);
    }
    exports2.ZodVoid = core2.$constructor("ZodVoid", (inst, def) => {
      core2.$ZodVoid.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.voidProcessor(inst, ctx, json2, params);
    });
    function _void(params) {
      return core2._void(exports2.ZodVoid, params);
    }
    exports2.ZodDate = core2.$constructor(
      "ZodDate",
      (inst, def) => {
        core2.$ZodDate.init(inst, def);
        exports2.ZodType.init(inst, def);
        inst._zod.processJSONSchema = (ctx, json2, params) => processors.dateProcessor(inst, ctx, json2, params);
        inst.min = (value, params) => inst.check(checks2.gte(value, params));
        inst.max = (value, params) => inst.check(checks2.lte(value, params));
      },
      /* @__PURE__ */ index_js_1.util.derived({
        minDate: (inst) => {
          const { minimum } = processors.aggregateChecks(inst);
          return minimum ? new Date(minimum) : null;
        },
        maxDate: (inst) => {
          const { maximum } = processors.aggregateChecks(inst);
          return maximum ? new Date(maximum) : null;
        }
      }, {})
    );
    function date(params) {
      return core2._date(exports2.ZodDate, params);
    }
    exports2.ZodArray = core2.$constructor("ZodArray", (inst, def) => {
      _ensureDefaultMemoizer();
      core2.$ZodArray.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.arrayProcessor(inst, ctx, json2, params);
      inst.element = def.element;
    }, {
      min(n, params) {
        return this.check(checks2.minLength(n, params));
      },
      nonempty(params) {
        return this.check(checks2.minLength(1, params));
      },
      max(n, params) {
        return this.check(checks2.maxLength(n, params));
      },
      length(n, params) {
        return this.check(checks2.length(n, params));
      },
      unwrap() {
        return this.element;
      }
    });
    function array(element, params) {
      return core2._array(exports2.ZodArray, element, params);
    }
    function keyof(schema) {
      const shape = schema._zod.def.shape;
      return _enum(Object.keys(shape));
    }
    exports2.ZodObject = core2.$constructor("ZodObject", (inst, def) => {
      _ensureDefaultMemoizer();
      core2.$ZodObjectJIT.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.objectProcessor(inst, ctx, json2, params);
      index_js_1.util.installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
    }, {
      keyof() {
        return _enum(Object.keys(this._zod.def.shape));
      },
      catchall(catchall) {
        return this.clone(index_js_1.util.mergeDefs(this._zod.def, { catchall }));
      },
      passthrough() {
        return this.clone(index_js_1.util.mergeDefs(this._zod.def, { catchall: unknown() }));
      },
      loose() {
        return this.clone(index_js_1.util.mergeDefs(this._zod.def, { catchall: unknown() }));
      },
      strict() {
        return this.clone(index_js_1.util.mergeDefs(this._zod.def, { catchall: never() }));
      },
      strip() {
        return this.clone(index_js_1.util.mergeDefs(this._zod.def, { catchall: void 0 }));
      },
      extend(incoming) {
        return index_js_1.util.extend(this, incoming);
      },
      safeExtend(incoming) {
        return index_js_1.util.safeExtend(this, incoming);
      },
      merge(other) {
        return index_js_1.util.merge(this, other);
      },
      pick(mask) {
        return index_js_1.util.pick(this, mask);
      },
      omit(mask) {
        return index_js_1.util.omit(this, mask);
      },
      partial(...args) {
        return index_js_1.util.partial(exports2.ZodOptional, this, args[0]);
      },
      exactPartial(...args) {
        return index_js_1.util.partial(exports2.ZodExactOptional, this, args[0], "exactPartial");
      },
      required(...args) {
        return index_js_1.util.required(exports2.ZodNonOptional, this, args[0]);
      }
    });
    function object(shape, params) {
      const def = {
        type: "object",
        shape: shape ?? {},
        ...index_js_1.util.normalizeParams(params)
      };
      return new exports2.ZodObject(def);
    }
    function strictObject(shape, params) {
      return new exports2.ZodObject({
        type: "object",
        shape,
        catchall: never(),
        ...index_js_1.util.normalizeParams(params)
      });
    }
    function looseObject(shape, params) {
      return new exports2.ZodObject({
        type: "object",
        shape,
        catchall: unknown(),
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodUnion = core2.$constructor("ZodUnion", (inst, def) => {
      core2.$ZodUnion.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.unionProcessor(inst, ctx, json2, params);
      inst.options = def.options;
    });
    function union(options, params) {
      return new exports2.ZodUnion({
        type: "union",
        options,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodXor = core2.$constructor("ZodXor", (inst, def) => {
      exports2.ZodUnion.init(inst, def);
      core2.$ZodXor.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.unionProcessor(inst, ctx, json2, params);
      inst.options = def.options;
    });
    function xor(options, params) {
      return new exports2.ZodXor({
        type: "union",
        options,
        inclusive: false,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodDiscriminatedUnion = core2.$constructor("ZodDiscriminatedUnion", (inst, def) => {
      exports2.ZodUnion.init(inst, def);
      core2.$ZodDiscriminatedUnion.init(inst, def);
    });
    function discriminatedUnion(discriminator, options, params) {
      return new exports2.ZodDiscriminatedUnion({
        type: "union",
        options,
        discriminator,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodIntersection = core2.$constructor("ZodIntersection", (inst, def) => {
      core2.$ZodIntersection.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.intersectionProcessor(inst, ctx, json2, params);
    });
    function intersection(left, right) {
      return new exports2.ZodIntersection({
        type: "intersection",
        left,
        right
      });
    }
    exports2.ZodTuple = core2.$constructor("ZodTuple", (inst, def) => {
      _ensureDefaultMemoizer();
      core2.$ZodTuple.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.tupleProcessor(inst, ctx, json2, params);
    }, {
      rest(rest) {
        return this.clone({
          ...this._zod.def,
          rest
        });
      },
      partial() {
        const def = this._zod.def;
        if (def.checks?.length)
          throw new Error(".partial() cannot be used on tuple schemas containing refinements");
        return this.clone({
          ...def,
          items: def.items.map((item) => new exports2.ZodOptional({ type: "optional", innerType: item }))
        });
      }
    });
    function tuple(items, _paramsOrRest, _params) {
      const hasRest = _paramsOrRest instanceof core2.$ZodType;
      const params = hasRest ? _params : _paramsOrRest;
      const rest = hasRest ? _paramsOrRest : null;
      return new exports2.ZodTuple({
        type: "tuple",
        items,
        rest,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodRecord = core2.$constructor("ZodRecord", (inst, def) => {
      _ensureDefaultMemoizer();
      core2.$ZodRecord.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.recordProcessor(inst, ctx, json2, params);
      inst.keyType = def.keyType;
      inst.valueType = def.valueType;
    });
    function record(keyType, valueType, params) {
      if (!valueType || !valueType._zod) {
        return new exports2.ZodRecord({
          type: "record",
          keyType: string(),
          valueType: keyType,
          ...index_js_1.util.normalizeParams(valueType)
        });
      }
      return new exports2.ZodRecord({
        type: "record",
        keyType,
        valueType,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    function partialRecord(keyType, valueType, params) {
      return new exports2.ZodRecord({
        type: "record",
        keyType,
        valueType,
        ...index_js_1.util.normalizeParams(params),
        partial: true
      });
    }
    function looseRecord(keyType, valueType, params) {
      return new exports2.ZodRecord({
        type: "record",
        keyType,
        valueType,
        mode: "loose",
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodMap = core2.$constructor("ZodMap", (inst, def) => {
      _ensureDefaultMemoizer();
      core2.$ZodMap.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.mapProcessor(inst, ctx, json2, params);
      inst.keyType = def.keyType;
      inst.valueType = def.valueType;
      inst.min = (...args) => inst.check(core2._minSize(...args));
      inst.nonempty = (params) => inst.check(core2._minSize(1, params));
      inst.max = (...args) => inst.check(core2._maxSize(...args));
      inst.size = (...args) => inst.check(core2._size(...args));
    });
    function map(keyType, valueType, params) {
      return new exports2.ZodMap({
        type: "map",
        keyType,
        valueType,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodSet = core2.$constructor("ZodSet", (inst, def) => {
      _ensureDefaultMemoizer();
      core2.$ZodSet.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.setProcessor(inst, ctx, json2, params);
      inst.min = (...args) => inst.check(core2._minSize(...args));
      inst.nonempty = (params) => inst.check(core2._minSize(1, params));
      inst.max = (...args) => inst.check(core2._maxSize(...args));
      inst.size = (...args) => inst.check(core2._size(...args));
    });
    function set(valueType, params) {
      return new exports2.ZodSet({
        type: "set",
        valueType,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodEnum = core2.$constructor("ZodEnum", (inst, def) => {
      core2.$ZodEnum.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.enumProcessor(inst, ctx, json2, params);
      inst.enum = def.entries;
      inst.options = [...inst._zod.values];
      const keys = new Set(Object.keys(def.entries));
      inst.extract = (values, params) => {
        const newEntries = {};
        for (const value of values) {
          if (keys.has(value)) {
            newEntries[value] = def.entries[value];
          } else
            throw new Error(`Key ${value} not found in enum`);
        }
        return new exports2.ZodEnum({
          ...def,
          checks: [],
          ...index_js_1.util.normalizeParams(params),
          entries: newEntries
        });
      };
      inst.exclude = (values, params) => {
        const newEntries = { ...def.entries };
        for (const value of values) {
          if (keys.has(value)) {
            delete newEntries[value];
          } else
            throw new Error(`Key ${value} not found in enum`);
        }
        return new exports2.ZodEnum({
          ...def,
          checks: [],
          ...index_js_1.util.normalizeParams(params),
          entries: newEntries
        });
      };
    });
    function _enum(values, params) {
      const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
      return new exports2.ZodEnum({
        type: "enum",
        entries,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    function nativeEnum(entries, params) {
      return new exports2.ZodEnum({
        type: "enum",
        entries,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodLiteral = core2.$constructor("ZodLiteral", (inst, def) => {
      core2.$ZodLiteral.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.literalProcessor(inst, ctx, json2, params);
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
      return new exports2.ZodLiteral({
        type: "literal",
        values: Array.isArray(value) ? value : [value],
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodFile = core2.$constructor("ZodFile", (inst, def) => {
      core2.$ZodFile.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.fileProcessor(inst, ctx, json2, params);
      inst.min = (size, params) => inst.check(core2._minSize(size, params));
      inst.max = (size, params) => inst.check(core2._maxSize(size, params));
      inst.mime = (types, params) => inst.check(core2._mime(Array.isArray(types) ? types : [types], params));
    });
    function file(params) {
      return core2._file(exports2.ZodFile, params);
    }
    exports2.ZodTransform = core2.$constructor("ZodTransform", (inst, def) => {
      _ensureDefaultMemoizer();
      core2.$ZodTransform.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.transformProcessor(inst, ctx, json2, params);
      inst._zod.parse = (payload, _ctx) => {
        if (_ctx.direction === "backward") {
          throw new core2.$ZodEncodeError(inst.constructor.name);
        }
        payload.addIssue = (issue) => {
          if (typeof issue === "string") {
            payload.issues.push(index_js_1.util.issue(issue, payload.value, def));
          } else {
            const _issue = issue;
            if (_issue.fatal)
              _issue.continue = false;
            _issue.code ?? (_issue.code = "custom");
            if (!("input" in _issue))
              _issue.input = payload.value;
            _issue.inst ?? (_issue.inst = inst);
            payload.issues.push(index_js_1.util.issue(_issue));
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
      return new exports2.ZodTransform({
        type: "transform",
        transform: fn
      });
    }
    exports2.ZodOptional = core2.$constructor("ZodOptional", (inst, def) => {
      core2.$ZodOptional.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.optionalProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    function optional(innerType) {
      return new exports2.ZodOptional({
        type: "optional",
        innerType
      });
    }
    exports2.ZodExactOptional = core2.$constructor("ZodExactOptional", (inst, def) => {
      core2.$ZodExactOptional.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.optionalProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    function exactOptional(innerType) {
      return new exports2.ZodExactOptional({
        type: "optional",
        innerType
      });
    }
    exports2.ZodNullable = core2.$constructor("ZodNullable", (inst, def) => {
      core2.$ZodNullable.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.nullableProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    function nullable(innerType) {
      return new exports2.ZodNullable({
        type: "nullable",
        innerType
      });
    }
    function nullish(innerType) {
      return optional(nullable(innerType));
    }
    exports2.ZodDefault = core2.$constructor("ZodDefault", (inst, def) => {
      core2.$ZodDefault.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.defaultProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
      inst.removeDefault = inst.unwrap;
    });
    function _default(innerType, defaultValue) {
      return new exports2.ZodDefault({
        type: "default",
        innerType,
        get defaultValue() {
          return typeof defaultValue === "function" ? defaultValue() : index_js_1.util.shallowClone(defaultValue);
        }
      });
    }
    exports2.ZodPrefault = core2.$constructor("ZodPrefault", (inst, def) => {
      core2.$ZodPrefault.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.prefaultProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    function prefault(innerType, defaultValue) {
      return new exports2.ZodPrefault({
        type: "prefault",
        innerType,
        get defaultValue() {
          return typeof defaultValue === "function" ? defaultValue() : index_js_1.util.shallowClone(defaultValue);
        }
      });
    }
    exports2.ZodNonOptional = core2.$constructor("ZodNonOptional", (inst, def) => {
      core2.$ZodNonOptional.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.nonoptionalProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    function nonoptional(innerType, params) {
      return new exports2.ZodNonOptional({
        type: "nonoptional",
        innerType,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodSuccess = core2.$constructor("ZodSuccess", (inst, def) => {
      core2.$ZodSuccess.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.successProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    function success(innerType) {
      return new exports2.ZodSuccess({
        type: "success",
        innerType
      });
    }
    exports2.ZodCatch = core2.$constructor("ZodCatch", (inst, def) => {
      core2.$ZodCatch.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.catchProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
      inst.removeCatch = inst.unwrap;
    });
    function _catch(innerType, catchValue) {
      return new exports2.ZodCatch({
        type: "catch",
        innerType,
        catchValue: typeof catchValue === "function" ? catchValue : core2.util.constantCatch(catchValue)
      });
    }
    exports2.ZodNaN = core2.$constructor("ZodNaN", (inst, def) => {
      core2.$ZodNaN.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.nanProcessor(inst, ctx, json2, params);
    });
    function nan(params) {
      return core2._nan(exports2.ZodNaN, params);
    }
    exports2.ZodPipe = core2.$constructor("ZodPipe", (inst, def) => {
      core2.$ZodPipe.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.pipeProcessor(inst, ctx, json2, params);
      inst.in = def.in;
      inst.out = def.out;
    });
    function pipe(in_, out) {
      return new exports2.ZodPipe({
        type: "pipe",
        in: in_,
        out
        // ...util.normalizeParams(params),
      });
    }
    exports2.ZodCodec = core2.$constructor("ZodCodec", (inst, def) => {
      exports2.ZodPipe.init(inst, def);
      core2.$ZodCodec.init(inst, def);
    });
    function codec(in_, out, params) {
      return new exports2.ZodCodec({
        type: "pipe",
        in: in_,
        out,
        transform: params.decode,
        reverseTransform: params.encode
      });
    }
    function invertCodec(codec2) {
      const def = codec2._zod.def;
      return new exports2.ZodCodec({
        type: "pipe",
        in: def.out,
        out: def.in,
        transform: def.reverseTransform,
        reverseTransform: def.transform
      });
    }
    exports2.ZodPreprocess = core2.$constructor("ZodPreprocess", (inst, def) => {
      exports2.ZodPipe.init(inst, def);
      core2.$ZodPreprocess.init(inst, def);
    });
    exports2.ZodReadonly = core2.$constructor("ZodReadonly", (inst, def) => {
      core2.$ZodReadonly.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.readonlyProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    function readonly(innerType) {
      return new exports2.ZodReadonly({
        type: "readonly",
        innerType
      });
    }
    exports2.ZodTemplateLiteral = core2.$constructor("ZodTemplateLiteral", (inst, def) => {
      core2.$ZodTemplateLiteral.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.templateLiteralProcessor(inst, ctx, json2, params);
    });
    function templateLiteral(parts, params) {
      return new exports2.ZodTemplateLiteral({
        type: "template_literal",
        parts,
        ...index_js_1.util.normalizeParams(params)
      });
    }
    exports2.ZodLazy = core2.$constructor("ZodLazy", (inst, def) => {
      core2.$ZodLazy.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.lazyProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.getter();
    });
    function lazy(getter) {
      return new exports2.ZodLazy({
        type: "lazy",
        getter
      });
    }
    exports2.ZodPromise = core2.$constructor("ZodPromise", (inst, def) => {
      core2.$ZodPromise.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.promiseProcessor(inst, ctx, json2, params);
      inst.unwrap = () => inst._zod.def.innerType;
    });
    function promise(innerType) {
      return new exports2.ZodPromise({
        type: "promise",
        innerType
      });
    }
    exports2.ZodFunction = core2.$constructor("ZodFunction", (inst, def) => {
      core2.$ZodFunction.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.functionProcessor(inst, ctx, json2, params);
    });
    function _function(params) {
      return new exports2.ZodFunction({
        type: "function",
        input: Array.isArray(params?.input) ? tuple(params?.input) : params?.input ?? array(unknown()),
        output: params?.output ?? unknown()
      });
    }
    exports2.ZodCustom = core2.$constructor("ZodCustom", (inst, def) => {
      core2.$ZodCustom.init(inst, def);
      exports2.ZodType.init(inst, def);
      inst._zod.processJSONSchema = (ctx, json2, params) => processors.customProcessor(inst, ctx, json2, params);
    });
    function check(fn) {
      const ch = new core2.$ZodCheck({
        check: "custom"
        // ...util.normalizeParams(params),
      });
      ch._zod.check = fn;
      return ch;
    }
    function custom(fn, _params) {
      return core2._custom(exports2.ZodCustom, fn ?? (() => true), _params);
    }
    function refine(fn, _params = {}) {
      return core2._refine(exports2.ZodCustom, fn, _params);
    }
    function superRefine(fn, params) {
      return core2._superRefine(fn, params);
    }
    exports2.describe = core2.describe;
    exports2.meta = core2.meta;
    exports2.ZodInstanceOf = core2.$constructor("ZodInstanceOf", (inst, def) => {
      exports2.ZodCustom.init(inst, def);
    }, {
      properties(shape, params) {
        return this.check(core2._properties(shape, params));
      }
    });
    function _instanceof(cls, params = {}) {
      const inst = new exports2.ZodInstanceOf({
        type: "custom",
        check: "custom",
        fn: (data2) => data2 instanceof cls,
        abort: true,
        ...index_js_1.util.normalizeParams(params)
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
    const stringbool = (...args) => core2._stringbool({
      Codec: exports2.ZodCodec,
      Boolean: exports2.ZodBoolean,
      String: exports2.ZodString
    }, ...args);
    exports2.stringbool = stringbool;
    function json(params) {
      const jsonSchema2 = lazy(() => {
        return union([string(params), number(), boolean(), _null(), array(jsonSchema2), record(string(), jsonSchema2)]);
      });
      return jsonSchema2;
    }
    function preprocess(fn, schema) {
      return new exports2.ZodPreprocess({
        type: "pipe",
        in: transform(fn),
        out: schema
      });
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(schemas);
  return schemas;
}
var compat = {};
var hasRequiredCompat;
function requireCompat() {
  if (hasRequiredCompat) return compat;
  hasRequiredCompat = 1;
  (function(exports2) {
    var __createBinding = compat && compat.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = compat && compat.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = compat && compat.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ZodFirstPartyTypeKind = exports2.config = exports2.$brand = exports2.ZodIssueCode = void 0;
    exports2.setErrorMap = setErrorMap;
    exports2.getErrorMap = getErrorMap;
    const core2 = __importStar(/* @__PURE__ */ requireCore());
    exports2.ZodIssueCode = {
      invalid_type: "invalid_type",
      too_big: "too_big",
      too_small: "too_small",
      invalid_format: "invalid_format",
      not_multiple_of: "not_multiple_of",
      unrecognized_keys: "unrecognized_keys",
      invalid_union: "invalid_union",
      invalid_key: "invalid_key",
      invalid_element: "invalid_element",
      invalid_value: "invalid_value",
      custom: "custom"
    };
    var index_js_1 = /* @__PURE__ */ requireCore();
    Object.defineProperty(exports2, "$brand", { enumerable: true, get: function() {
      return index_js_1.$brand;
    } });
    Object.defineProperty(exports2, "config", { enumerable: true, get: function() {
      return index_js_1.config;
    } });
    function setErrorMap(map) {
      core2.config({
        customError: map
      });
    }
    function getErrorMap() {
      return core2.config().customError;
    }
    var ZodFirstPartyTypeKind;
    /* @__PURE__ */ (function(ZodFirstPartyTypeKind2) {
    })(ZodFirstPartyTypeKind || (exports2.ZodFirstPartyTypeKind = ZodFirstPartyTypeKind = {}));
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(compat);
  return compat;
}
var fromJsonSchema = {};
var iso = {};
var hasRequiredIso;
function requireIso() {
  if (hasRequiredIso) return iso;
  hasRequiredIso = 1;
  (function(exports2) {
    var __createBinding = iso && iso.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = iso && iso.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = iso && iso.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ZodISOTime = exports2.ZodISODuration = exports2.ZodISODateTime = exports2.ZodISODate = void 0;
    exports2.datetime = datetime;
    exports2.date = date;
    exports2.time = time;
    exports2.duration = duration;
    const core2 = __importStar(/* @__PURE__ */ requireCore());
    const schemas_js_1 = /* @__PURE__ */ requireSchemas();
    var schemas_js_2 = /* @__PURE__ */ requireSchemas();
    Object.defineProperty(exports2, "ZodISODate", { enumerable: true, get: function() {
      return schemas_js_2.ZodISODate;
    } });
    Object.defineProperty(exports2, "ZodISODateTime", { enumerable: true, get: function() {
      return schemas_js_2.ZodISODateTime;
    } });
    Object.defineProperty(exports2, "ZodISODuration", { enumerable: true, get: function() {
      return schemas_js_2.ZodISODuration;
    } });
    Object.defineProperty(exports2, "ZodISOTime", { enumerable: true, get: function() {
      return schemas_js_2.ZodISOTime;
    } });
    function datetime(params) {
      return core2._isoDateTime(schemas_js_1.ZodISODateTime, params);
    }
    function date(params) {
      return core2._isoDate(schemas_js_1.ZodISODate, params);
    }
    function time(params) {
      return core2._isoTime(schemas_js_1.ZodISOTime, params);
    }
    function duration(params) {
      return core2._isoDuration(schemas_js_1.ZodISODuration, params);
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(iso);
  return iso;
}
var hasRequiredFromJsonSchema;
function requireFromJsonSchema() {
  if (hasRequiredFromJsonSchema) return fromJsonSchema;
  hasRequiredFromJsonSchema = 1;
  (function(exports2) {
    var __createBinding = fromJsonSchema && fromJsonSchema.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = fromJsonSchema && fromJsonSchema.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = fromJsonSchema && fromJsonSchema.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.fromJSONSchema = fromJSONSchema;
    const registries_js_1 = /* @__PURE__ */ requireRegistries();
    const util_js_1 = /* @__PURE__ */ requireUtil();
    const _checks = __importStar(/* @__PURE__ */ requireChecks());
    const _iso = __importStar(/* @__PURE__ */ requireIso());
    const _schemas = __importStar(/* @__PURE__ */ requireSchemas());
    const z = {
      ..._schemas,
      ..._checks,
      iso: _iso
    };
    const RECOGNIZED_KEYS = /* @__PURE__ */ new Set([
      // Schema identification
      "$schema",
      "$ref",
      "$defs",
      "definitions",
      // Core schema keywords
      "$id",
      "id",
      "$comment",
      "$anchor",
      "$vocabulary",
      "$dynamicRef",
      "$dynamicAnchor",
      // Type
      "type",
      "enum",
      "const",
      // Composition
      "anyOf",
      "oneOf",
      "allOf",
      "not",
      // Object
      "properties",
      "required",
      "additionalProperties",
      "patternProperties",
      "propertyNames",
      "minProperties",
      "maxProperties",
      // Array
      "items",
      "prefixItems",
      "additionalItems",
      "minItems",
      "maxItems",
      "uniqueItems",
      "contains",
      "minContains",
      "maxContains",
      // String
      "minLength",
      "maxLength",
      "pattern",
      "format",
      // Number
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf",
      // Already handled metadata
      "description",
      "default",
      // Content
      "contentEncoding",
      "contentMediaType",
      "contentSchema",
      // Unsupported (error-throwing)
      "unevaluatedItems",
      "unevaluatedProperties",
      "if",
      "then",
      "else",
      "dependentSchemas",
      "dependentRequired",
      // OpenAPI
      "nullable",
      "readOnly"
    ]);
    function detectVersion(schema, defaultTarget) {
      const $schema = schema.$schema;
      if ($schema === "https://json-schema.org/draft/2020-12/schema") {
        return "draft-2020-12";
      }
      if ($schema === "http://json-schema.org/draft-07/schema#") {
        return "draft-7";
      }
      if ($schema === "http://json-schema.org/draft-04/schema#") {
        return "draft-4";
      }
      return defaultTarget ?? "draft-2020-12";
    }
    function applyMinItems(items, minItems) {
      return items.map((item, index) => index < minItems ? item : item.optional());
    }
    function decodeJSONPointerSegment(segment) {
      return segment.replace(/~1/g, "/").replace(/~0/g, "~");
    }
    function resolveRef(ref, ctx) {
      if (!ref.startsWith("#")) {
        throw new Error("External $ref is not supported, only local refs (#/...) are allowed");
      }
      const path2 = ref.slice(1).split("/").filter(Boolean);
      if (path2.length === 0) {
        return ctx.rootSchema;
      }
      const defsKey = ctx.version === "draft-2020-12" ? "$defs" : "definitions";
      if (path2[0] === defsKey) {
        const key = path2[1] === void 0 ? void 0 : decodeJSONPointerSegment(path2[1]);
        if (!key || !ctx.defs[key]) {
          throw new Error(`Reference not found: ${ref}`);
        }
        return ctx.defs[key];
      }
      throw new Error(`Reference not found: ${ref}`);
    }
    function checkObjectGuards(objectSchema, guards) {
      const guard = z.transform((value) => value).check((payload) => {
        const value = payload.value;
        if (typeof value !== "object" || value === null || Array.isArray(value))
          return;
        const keys = Object.getOwnPropertyNames(value);
        if (guards.minProperties !== void 0 && keys.length < guards.minProperties) {
          payload.issues.push({
            origin: "object",
            code: "too_small",
            minimum: guards.minProperties,
            inclusive: true,
            message: `Too small: expected object to have >=${guards.minProperties} properties`,
            input: value,
            inst: objectSchema,
            continue: true
          });
        }
        if (guards.maxProperties !== void 0 && keys.length > guards.maxProperties) {
          payload.issues.push({
            origin: "object",
            code: "too_big",
            maximum: guards.maxProperties,
            inclusive: true,
            message: `Too big: expected object to have <=${guards.maxProperties} properties`,
            input: value,
            inst: objectSchema,
            continue: true
          });
        }
        if (guards.keySchema) {
          for (const key of keys) {
            const result = guards.keySchema.safeParse(key);
            if (result.success)
              continue;
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: result.error.issues,
              input: key,
              path: [key],
              continue: true
            });
          }
        }
      });
      return guard.pipe(objectSchema);
    }
    function canonicalKey(value, seen) {
      if (value === null)
        return "z";
      const type = typeof value;
      if (type !== "object") {
        if (type === "number" && Number.isNaN(value))
          return null;
        const raw2 = String(value);
        return `${type[0]}${raw2.length}:${raw2}`;
      }
      if (seen.has(value))
        return null;
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          const parts2 = [];
          for (const item of value) {
            const key = canonicalKey(item, seen);
            if (key === null)
              return null;
            parts2.push(key);
          }
          return `a${parts2.length}:[${parts2.join(",")}]`;
        }
        const keys = Object.keys(value).sort();
        const parts = [];
        for (const k of keys) {
          const key = canonicalKey(value[k], seen);
          if (key === null)
            return null;
          parts.push(`${k.length}:${k}=${key}`);
        }
        return `o${parts.length}:{${parts.join(",")}}`;
      } finally {
        seen.delete(value);
      }
    }
    const SCHEMA_KEYWORDS = /* @__PURE__ */ new Set([
      "items",
      "prefixItems",
      "additionalItems",
      "additionalProperties",
      "contains",
      "propertyNames",
      "not",
      "if",
      "then",
      "else",
      "allOf",
      "anyOf",
      "oneOf",
      "unevaluatedItems",
      "unevaluatedProperties",
      "contentSchema"
    ]);
    const SCHEMA_MAP_KEYWORDS = /* @__PURE__ */ new Set([
      "properties",
      "patternProperties",
      "dependentSchemas",
      "dependencies",
      "$defs",
      "definitions"
    ]);
    function containsRef(value) {
      if (typeof value !== "object" || value === null)
        return false;
      if (Array.isArray(value))
        return value.some(containsRef);
      if (typeof value.$ref === "string")
        return true;
      return Object.entries(value).some(([key, sub]) => {
        if (SCHEMA_KEYWORDS.has(key))
          return containsRef(sub);
        if (!SCHEMA_MAP_KEYWORDS.has(key) || typeof sub !== "object" || sub === null)
          return false;
        return Object.values(sub).some(containsRef);
      });
    }
    function plural(n) {
      return n === 1 ? "element" : "elements";
    }
    function checkArrayGuards(arraySchema, guards) {
      const guard = z.transform((value) => value).check((payload) => {
        const items = payload.value;
        if (!Array.isArray(items))
          return;
        if (guards.uniqueItems === true) {
          const firstSeen = /* @__PURE__ */ new Map();
          for (let i = 0; i < items.length; i++) {
            const key = canonicalKey(items[i], /* @__PURE__ */ new Set());
            if (key === null)
              continue;
            const first = firstSeen.get(key);
            if (first === void 0) {
              firstSeen.set(key, i);
              continue;
            }
            payload.issues.push({
              code: "custom",
              message: `Array items must be unique: element at index ${i} duplicates the one at index ${first}`,
              input: items,
              path: [i],
              continue: true
            });
          }
        }
        if (guards.containsSchema) {
          const minContains = guards.minContains ?? 1;
          const ceiling = guards.maxContains !== void 0 ? guards.maxContains + 1 : Number.POSITIVE_INFINITY;
          let matches = 0;
          for (const item of items) {
            if (guards.containsSchema.safeParse(item).success && ++matches >= ceiling)
              break;
          }
          if (matches < minContains) {
            payload.issues.push({
              code: "custom",
              message: `Array must contain at least ${minContains} matching ${plural(minContains)}; found ${matches}`,
              input: items,
              continue: true
            });
          }
          if (guards.maxContains !== void 0 && matches > guards.maxContains) {
            payload.issues.push({
              code: "custom",
              message: `Array must contain at most ${guards.maxContains} matching ${plural(guards.maxContains)}`,
              input: items,
              continue: true
            });
          }
        }
      });
      return guard.pipe(arraySchema);
    }
    function getTupleRest(restSchema, ctx) {
      if (restSchema === false) {
        return void 0;
      }
      if (restSchema === void 0 || restSchema === true) {
        return z.any();
      }
      return convertSchema(restSchema, ctx);
    }
    const fullTime = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
    function convertBaseSchema(schema, ctx) {
      if (schema.not !== void 0) {
        if (typeof schema.not === "object" && Object.keys(schema.not).length === 0) {
          return z.never();
        }
        throw new Error("not is not supported in Zod (except { not: {} } for never)");
      }
      if (schema.unevaluatedItems !== void 0) {
        throw new Error("unevaluatedItems is not supported");
      }
      if (schema.unevaluatedProperties !== void 0) {
        throw new Error("unevaluatedProperties is not supported");
      }
      if (schema.if !== void 0 || schema.then !== void 0 || schema.else !== void 0) {
        throw new Error("Conditional schemas (if/then/else) are not supported");
      }
      if (schema.dependentSchemas !== void 0 || schema.dependentRequired !== void 0) {
        throw new Error("dependentSchemas and dependentRequired are not supported");
      }
      if (schema.$ref) {
        const refPath = schema.$ref;
        if (ctx.refs.has(refPath)) {
          return ctx.refs.get(refPath);
        }
        if (ctx.processing.has(refPath)) {
          return z.lazy(() => {
            if (!ctx.refs.has(refPath)) {
              throw new Error(`Circular reference not resolved: ${refPath}`);
            }
            return ctx.refs.get(refPath);
          });
        }
        ctx.processing.add(refPath);
        const resolved = resolveRef(refPath, ctx);
        const zodSchema2 = convertSchema(resolved, ctx);
        ctx.refs.set(refPath, zodSchema2);
        ctx.processing.delete(refPath);
        return zodSchema2;
      }
      if (schema.enum !== void 0) {
        const enumValues = schema.enum;
        if (ctx.version === "openapi-3.0" && schema.nullable === true && enumValues.length === 1 && enumValues[0] === null) {
          return z.null();
        }
        if (enumValues.length === 0) {
          return z.never();
        }
        if (enumValues.length === 1) {
          return z.literal(enumValues[0]);
        }
        if (enumValues.every((v) => typeof v === "string")) {
          return z.enum(enumValues);
        }
        const literalSchemas = enumValues.map((v) => z.literal(v));
        if (literalSchemas.length < 2) {
          return literalSchemas[0];
        }
        return z.union([literalSchemas[0], literalSchemas[1], ...literalSchemas.slice(2)]);
      }
      if (schema.const !== void 0) {
        return z.literal(schema.const);
      }
      const type = schema.type;
      if (Array.isArray(type)) {
        const typeSchemas = type.map((t) => {
          const typeSchema = { ...schema, type: t };
          return convertBaseSchema(typeSchema, ctx);
        });
        if (typeSchemas.length === 0) {
          return z.never();
        }
        if (typeSchemas.length === 1) {
          return typeSchemas[0];
        }
        return z.union(typeSchemas);
      }
      if (!type) {
        return z.any();
      }
      let zodSchema;
      switch (type) {
        case "string": {
          let stringSchema = z.string();
          if (schema.format) {
            const format = schema.format;
            if (format === "email") {
              stringSchema = stringSchema.check(z.email());
            } else if (format === "uri" || format === "uri-reference") {
              stringSchema = stringSchema.check(z.url());
            } else if (format === "uuid" || format === "guid") {
              stringSchema = stringSchema.check(z.uuid());
            } else if (format === "date-time") {
              stringSchema = stringSchema.check(z.iso.datetime({ offset: true }));
            } else if (format === "date") {
              stringSchema = stringSchema.check(z.iso.date());
            } else if (format === "time") {
              stringSchema = stringSchema.check(z.regex(fullTime));
            } else if (format === "duration") {
              stringSchema = stringSchema.check(z.iso.duration());
            } else if (format === "hostname") {
              stringSchema = stringSchema.check(z.hostname());
            } else if (format === "ipv4") {
              stringSchema = stringSchema.check(z.ipv4());
            } else if (format === "ipv6") {
              stringSchema = stringSchema.check(z.ipv6());
            } else if (format === "mac") {
              stringSchema = stringSchema.check(z.mac());
            } else if (format === "cidr") {
              stringSchema = stringSchema.check(z.cidrv4());
            } else if (format === "cidr-v6") {
              stringSchema = stringSchema.check(z.cidrv6());
            } else if (format === "base64") {
              stringSchema = stringSchema.check(z.base64());
            } else if (format === "base64url") {
              stringSchema = stringSchema.check(z.base64url());
            } else if (format === "e164") {
              stringSchema = stringSchema.check(z.e164());
            } else if (format === "credit_card") {
              stringSchema = stringSchema.check(z.creditCard());
            } else if (format === "iban") {
              stringSchema = stringSchema.check(z.iban());
            } else if (format === "jwt") {
              stringSchema = stringSchema.check(z.jwt());
            } else if (format === "emoji") {
              stringSchema = stringSchema.check(z.emoji());
            } else if (format === "nanoid") {
              stringSchema = stringSchema.check(z.nanoid());
            } else if (format === "cuid") {
              stringSchema = stringSchema.check(z.cuid());
            } else if (format === "cuid2") {
              stringSchema = stringSchema.check(z.cuid2());
            } else if (format === "ulid") {
              stringSchema = stringSchema.check(z.ulid());
            } else if (format === "xid") {
              stringSchema = stringSchema.check(z.xid());
            } else if (format === "ksuid") {
              stringSchema = stringSchema.check(z.ksuid());
            }
          }
          if (typeof schema.minLength === "number") {
            stringSchema = stringSchema.min(schema.minLength);
          }
          if (typeof schema.maxLength === "number") {
            stringSchema = stringSchema.max(schema.maxLength);
          }
          if (schema.pattern) {
            stringSchema = stringSchema.regex(new RegExp(schema.pattern));
          }
          zodSchema = stringSchema;
          break;
        }
        case "number":
        case "integer": {
          let numberSchema = type === "integer" ? z.number().int() : z.number();
          if (typeof schema.minimum === "number" && schema.exclusiveMinimum !== true) {
            numberSchema = numberSchema.min(schema.minimum);
          }
          if (typeof schema.maximum === "number" && schema.exclusiveMaximum !== true) {
            numberSchema = numberSchema.max(schema.maximum);
          }
          if (typeof schema.exclusiveMinimum === "number") {
            numberSchema = numberSchema.gt(schema.exclusiveMinimum);
          } else if (schema.exclusiveMinimum === true && typeof schema.minimum === "number") {
            numberSchema = numberSchema.gt(schema.minimum);
          }
          if (typeof schema.exclusiveMaximum === "number") {
            numberSchema = numberSchema.lt(schema.exclusiveMaximum);
          } else if (schema.exclusiveMaximum === true && typeof schema.maximum === "number") {
            numberSchema = numberSchema.lt(schema.maximum);
          }
          if (typeof schema.multipleOf === "number") {
            numberSchema = numberSchema.multipleOf(schema.multipleOf);
          }
          zodSchema = numberSchema;
          break;
        }
        case "boolean": {
          zodSchema = z.boolean();
          break;
        }
        case "null": {
          zodSchema = z.null();
          break;
        }
        case "object": {
          const shape = {};
          const properties = schema.properties || {};
          const requiredSet = new Set(schema.required || []);
          const additionalSchema = typeof schema.additionalProperties === "object" ? convertSchema(schema.additionalProperties, ctx) : void 0;
          for (const [key, propSchema] of Object.entries(properties)) {
            const propZodSchema = convertSchema(propSchema, ctx);
            (0, util_js_1.assignProp)(shape, key, requiredSet.has(key) ? propZodSchema : propZodSchema.optional());
          }
          if (schema.patternProperties) {
            const patternProps = schema.patternProperties;
            const patternKeys = Object.keys(patternProps);
            const looseRecords = [];
            for (const pattern of patternKeys) {
              const patternValue = convertSchema(patternProps[pattern], ctx);
              const keySchema = z.string().regex(new RegExp(pattern));
              looseRecords.push(z.looseRecord(keySchema, patternValue));
            }
            const schemasToIntersect = [];
            if (Object.keys(shape).length > 0) {
              schemasToIntersect.push(z.object(shape).passthrough());
            }
            schemasToIntersect.push(...looseRecords);
            if (schemasToIntersect.length === 0) {
              zodSchema = z.object({}).passthrough();
            } else if (schemasToIntersect.length === 1) {
              zodSchema = schemasToIntersect[0];
            } else {
              let result = z.intersection(schemasToIntersect[0], schemasToIntersect[1]);
              for (let i = 2; i < schemasToIntersect.length; i++) {
                result = z.intersection(result, schemasToIntersect[i]);
              }
              zodSchema = result;
            }
            if (schema.additionalProperties === false) {
              const propertyKeys = Object.keys(shape);
              const patterns = patternKeys.map((p) => new RegExp(p));
              const basePatternSchema = zodSchema;
              zodSchema = zodSchema.check((payload) => {
                if (!(0, util_js_1.isPlainObject)(payload.value))
                  return;
                const unrecognized = [];
                for (const key of Object.keys(payload.value)) {
                  if (propertyKeys.includes(key))
                    continue;
                  if (patterns.some((regex) => regex.test(key)))
                    continue;
                  unrecognized.push(key);
                }
                if (unrecognized.length) {
                  payload.issues.push({
                    code: "unrecognized_keys",
                    keys: unrecognized,
                    input: payload.value,
                    inst: basePatternSchema
                  });
                }
              });
            }
          } else {
            const objectSchema = z.object(shape);
            if (schema.additionalProperties === false) {
              zodSchema = objectSchema.strict();
            } else if (additionalSchema) {
              zodSchema = objectSchema.catchall(additionalSchema);
            } else {
              zodSchema = objectSchema.passthrough();
            }
          }
          const hasKeyGuard = schema.propertyNames !== void 0 && schema.propertyNames !== true;
          const minProperties = typeof schema.minProperties === "number" ? schema.minProperties : void 0;
          const maxProperties = typeof schema.maxProperties === "number" ? schema.maxProperties : void 0;
          if (hasKeyGuard || minProperties !== void 0 || maxProperties !== void 0) {
            let keySchema;
            if (hasKeyGuard) {
              const keyJSONSchema = typeof schema.propertyNames === "object" && schema.propertyNames.type === void 0 ? { type: "string", ...schema.propertyNames } : schema.propertyNames;
              keySchema = convertSchema(keyJSONSchema, ctx);
            }
            zodSchema = checkObjectGuards(zodSchema, { keySchema, minProperties, maxProperties });
          }
          break;
        }
        case "array": {
          const prefixItems = schema.prefixItems;
          const items = schema.items;
          if (prefixItems && Array.isArray(prefixItems)) {
            const minItems = typeof schema.minItems === "number" ? schema.minItems : 0;
            const tupleItems = prefixItems.map((item) => convertSchema(item, ctx));
            const positionalItems = applyMinItems(tupleItems, minItems);
            const rest = !Array.isArray(items) ? getTupleRest(items, ctx) : void 0;
            const tupleSchema = z.tuple(positionalItems);
            zodSchema = rest ? tupleSchema.rest(rest) : tupleSchema;
            if (typeof schema.minItems === "number") {
              zodSchema = zodSchema.check(z.minLength(schema.minItems));
            }
            if (typeof schema.maxItems === "number") {
              zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
            }
          } else if (Array.isArray(items)) {
            const minItems = typeof schema.minItems === "number" ? schema.minItems : 0;
            const tupleItems = items.map((item) => convertSchema(item, ctx));
            const positionalItems = applyMinItems(tupleItems, minItems);
            const rest = getTupleRest(schema.additionalItems, ctx);
            const tupleSchema = z.tuple(positionalItems);
            zodSchema = rest ? tupleSchema.rest(rest) : tupleSchema;
            if (typeof schema.minItems === "number") {
              zodSchema = zodSchema.check(z.minLength(schema.minItems));
            }
            if (typeof schema.maxItems === "number") {
              zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
            }
          } else if (items !== void 0) {
            const element = convertSchema(items, ctx);
            let arraySchema = z.array(element);
            if (typeof schema.minItems === "number") {
              arraySchema = arraySchema.min(schema.minItems);
            }
            if (typeof schema.maxItems === "number") {
              arraySchema = arraySchema.max(schema.maxItems);
            }
            zodSchema = arraySchema;
          } else {
            zodSchema = z.array(z.any());
          }
          if (schema.uniqueItems === true || schema.contains !== void 0) {
            zodSchema = checkArrayGuards(zodSchema, {
              uniqueItems: schema.uniqueItems === true,
              containsSchema: schema.contains !== void 0 ? convertSchema(schema.contains, ctx) : void 0,
              minContains: typeof schema.minContains === "number" ? schema.minContains : void 0,
              maxContains: typeof schema.maxContains === "number" ? schema.maxContains : void 0
            });
          }
          break;
        }
        default:
          throw new Error(`Unsupported type: ${type}`);
      }
      return zodSchema;
    }
    function convertSchema(schema, ctx) {
      if (typeof schema === "boolean") {
        return schema ? z.any() : z.never();
      }
      let baseSchema = convertBaseSchema(schema, ctx);
      const hasExplicitType = schema.type || schema.enum !== void 0 || schema.const !== void 0;
      if (schema.anyOf && Array.isArray(schema.anyOf)) {
        const options = schema.anyOf.map((s) => convertSchema(s, ctx));
        const anyOfUnion = z.union(options);
        baseSchema = hasExplicitType ? z.intersection(baseSchema, anyOfUnion) : anyOfUnion;
      }
      if (schema.oneOf && Array.isArray(schema.oneOf)) {
        const options = schema.oneOf.map((s) => convertSchema(s, ctx));
        const oneOfUnion = z.xor(options);
        baseSchema = hasExplicitType ? z.intersection(baseSchema, oneOfUnion) : oneOfUnion;
      }
      if (schema.allOf && Array.isArray(schema.allOf)) {
        if (schema.allOf.length === 0) {
          baseSchema = hasExplicitType ? baseSchema : z.any();
        } else {
          let result = hasExplicitType ? baseSchema : convertSchema(schema.allOf[0], ctx);
          const startIdx = hasExplicitType ? 0 : 1;
          for (let i = startIdx; i < schema.allOf.length; i++) {
            result = z.intersection(result, convertSchema(schema.allOf[i], ctx));
          }
          baseSchema = result;
        }
      }
      if (schema.nullable === true && ctx.version === "openapi-3.0") {
        baseSchema = z.nullable(baseSchema);
      }
      if (schema.readOnly === true) {
        baseSchema = z.readonly(baseSchema);
      }
      if (schema.default !== void 0) {
        baseSchema = baseSchema.default(schema.default);
      }
      const extraMeta = {};
      const coreMetadataKeys = ["$id", "id", "$comment", "$anchor", "$vocabulary", "$dynamicRef", "$dynamicAnchor"];
      for (const key of coreMetadataKeys) {
        if (key in schema) {
          extraMeta[key] = schema[key];
        }
      }
      const contentMetadataKeys = ["contentEncoding", "contentMediaType", "contentSchema"];
      for (const key of contentMetadataKeys) {
        if (key in schema) {
          extraMeta[key] = schema[key];
        }
      }
      if (schema.type === "object" && schema.$ref === void 0) {
        if (schema.propertyNames !== void 0 && !containsRef(schema.propertyNames)) {
          extraMeta.propertyNames = schema.propertyNames;
        }
        for (const key of ["minProperties", "maxProperties"]) {
          if (schema[key] !== void 0)
            extraMeta[key] = schema[key];
        }
      }
      if (schema.type === "array" && schema.$ref === void 0) {
        if (schema.contains !== void 0 && !containsRef(schema.contains)) {
          extraMeta.contains = schema.contains;
        }
        for (const key of ["uniqueItems", "minContains", "maxContains"]) {
          if (schema[key] !== void 0)
            extraMeta[key] = schema[key];
        }
      }
      for (const key of Object.keys(schema)) {
        if (!RECOGNIZED_KEYS.has(key)) {
          (0, util_js_1.assignProp)(extraMeta, key, schema[key]);
        }
      }
      if (Object.keys(extraMeta).length > 0) {
        ctx.registry.add(baseSchema, extraMeta);
      }
      if (schema.description) {
        baseSchema = baseSchema.describe(schema.description);
      }
      return baseSchema;
    }
    function fromJSONSchema(schema, params) {
      if (typeof schema === "boolean") {
        return schema ? z.any() : z.never();
      }
      let normalized;
      try {
        normalized = JSON.parse(JSON.stringify(schema));
      } catch {
        throw new Error("fromJSONSchema input is not valid JSON (possibly cyclic); use $defs/$ref for recursive schemas");
      }
      const version2 = detectVersion(normalized, params?.defaultTarget);
      const defs = normalized.$defs || normalized.definitions || {};
      const ctx = {
        version: version2,
        defs,
        refs: /* @__PURE__ */ new Map(),
        processing: /* @__PURE__ */ new Set(),
        rootSchema: normalized,
        registry: params?.registry ?? registries_js_1.globalRegistry
      };
      return convertSchema(normalized, ctx);
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(fromJsonSchema);
  return fromJsonSchema;
}
var deepPartial = {};
var visit = {};
var hasRequiredVisit;
function requireVisit() {
  if (hasRequiredVisit) return visit;
  hasRequiredVisit = 1;
  (function(exports2) {
    var __createBinding = visit && visit.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = visit && visit.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = visit && visit.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.visit = visit$1;
    const schemas2 = __importStar(/* @__PURE__ */ requireSchemas$1());
    const util_js_1 = /* @__PURE__ */ requireUtil();
    const RESOLVING = Symbol("z.visit/resolving");
    function visit$1(schema, fnOrHandlers) {
      const fn = typeof fnOrHandlers === "function" ? fnOrHandlers : (node, rewritten) => {
        const h = fnOrHandlers[node._zod.def.type];
        return h ? h(node, rewritten) : node;
      };
      const cache = /* @__PURE__ */ new Map();
      function run(s) {
        const cached = cache.get(s);
        if (cached === RESOLVING) {
          return new schemas2.$ZodLazy({
            type: "lazy",
            getter: () => cache.get(s)
          });
        }
        if (cached !== void 0)
          return cached;
        cache.set(s, RESOLVING);
        const inner = mapInner(s);
        const mapped = fn(inner, inner !== s);
        cache.set(s, mapped);
        return mapped;
      }
      function mapInner(s) {
        const def = s._zod.def;
        const kind = def.type;
        switch (kind) {
          case "object": {
            const oldShape = def.shape;
            const keys = Object.keys(oldShape);
            let changed = false;
            const newShape = {};
            for (const k of keys) {
              const mapped = run(oldShape[k]);
              if (mapped !== oldShape[k])
                changed = true;
              newShape[k] = mapped;
            }
            let newCatchall = def.catchall;
            if (def.catchall) {
              newCatchall = run(def.catchall);
              if (newCatchall !== def.catchall)
                changed = true;
            }
            return changed ? (0, util_js_1.clone)(s, { ...def, shape: newShape, catchall: newCatchall }) : s;
          }
          case "array": {
            const mapped = run(def.element);
            return mapped === def.element ? s : (0, util_js_1.clone)(s, { ...def, element: mapped });
          }
          case "tuple": {
            const oldItems = def.items;
            let changed = false;
            const newItems = [];
            for (const item of oldItems) {
              const mapped = run(item);
              if (mapped !== item)
                changed = true;
              newItems.push(mapped);
            }
            let newRest = def.rest;
            if (def.rest) {
              newRest = run(def.rest);
              if (newRest !== def.rest)
                changed = true;
            }
            return changed ? (0, util_js_1.clone)(s, { ...def, items: newItems, rest: newRest }) : s;
          }
          case "record":
          case "map": {
            const newKey = run(def.keyType);
            const newVal = run(def.valueType);
            return newKey === def.keyType && newVal === def.valueType ? s : (0, util_js_1.clone)(s, { ...def, keyType: newKey, valueType: newVal });
          }
          case "set": {
            const newVal = run(def.valueType);
            return newVal === def.valueType ? s : (0, util_js_1.clone)(s, { ...def, valueType: newVal });
          }
          case "union": {
            const oldOptions = def.options;
            let changed = false;
            const newOptions = [];
            for (const opt of oldOptions) {
              const mapped = run(opt);
              if (mapped !== opt)
                changed = true;
              newOptions.push(mapped);
            }
            return changed ? (0, util_js_1.clone)(s, { ...def, options: newOptions }) : s;
          }
          case "intersection": {
            const newLeft = run(def.left);
            const newRight = run(def.right);
            return newLeft === def.left && newRight === def.right ? s : (0, util_js_1.clone)(s, { ...def, left: newLeft, right: newRight });
          }
          case "optional":
          case "nullable":
          case "default":
          case "prefault":
          case "catch":
          case "readonly":
          case "nonoptional":
          case "promise":
          case "success": {
            const newInner = run(def.innerType);
            return newInner === def.innerType ? s : (0, util_js_1.clone)(s, { ...def, innerType: newInner });
          }
          case "pipe": {
            const newIn = run(def.in);
            const newOut = run(def.out);
            return newIn === def.in && newOut === def.out ? s : (0, util_js_1.clone)(s, { ...def, in: newIn, out: newOut });
          }
          case "function": {
            const newInput = run(def.input);
            const newOutput = run(def.output);
            return newInput === def.input && newOutput === def.output ? s : (0, util_js_1.clone)(s, { ...def, input: newInput, output: newOutput });
          }
          case "lazy": {
            const original = def.getter;
            const { _cachedInner, ...rest } = def;
            return (0, util_js_1.clone)(s, { ...rest, getter: () => run(original()) });
          }
          // A leaf by choice: `parts` are regex fragments, not data positions.
          case "template_literal":
          // Leaves.
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
            return s;
          default: {
            return s;
          }
        }
      }
      return run(schema);
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(visit);
  return visit;
}
var hasRequiredDeepPartial;
function requireDeepPartial() {
  if (hasRequiredDeepPartial) return deepPartial;
  hasRequiredDeepPartial = 1;
  (function(exports2) {
    var __createBinding = deepPartial && deepPartial.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = deepPartial && deepPartial.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = deepPartial && deepPartial.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.deepPartial = deepPartial$1;
    const visit_js_1 = /* @__PURE__ */ requireVisit();
    const schemas2 = __importStar(/* @__PURE__ */ requireSchemas());
    function deepPartial$1(schema) {
      return (0, visit_js_1.visit)(schema, {
        object: (s) => s.partial(),
        // Every partialed option now admits `undefined`, which the constructor rejects as a duplicate.
        union: (s) => {
          const def = s._zod.def;
          return def.discriminator === void 0 ? s : schemas2.union(def.options);
        }
      });
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(deepPartial);
  return deepPartial;
}
var inOut = {};
var hasRequiredInOut;
function requireInOut() {
  if (hasRequiredInOut) return inOut;
  hasRequiredInOut = 1;
  (function(exports2) {
    var __createBinding = inOut && inOut.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = inOut && inOut.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = inOut && inOut.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.input = input;
    exports2.output = output;
    const util_js_1 = /* @__PURE__ */ requireUtil();
    const visit_js_1 = /* @__PURE__ */ requireVisit();
    const schemas2 = __importStar(/* @__PURE__ */ requireSchemas());
    function withChecks(side, checks2) {
      if (!checks2?.length)
        return side;
      const def = side._zod.def;
      return (0, util_js_1.clone)(side, (0, util_js_1.mergeDefs)(def, { checks: [...def.checks ?? [], ...checks2] }), { parent: true });
    }
    function outSide(def) {
      return withChecks(def.out, def.checks);
    }
    function inSide(def) {
      return def.in._zod.traits.has("$ZodTransform") ? outSide(def) : def.in;
    }
    function input(schema) {
      return (0, visit_js_1.visit)(schema, {
        pipe: (s) => inSide(s._zod.def),
        // A default value belongs to the output side, so a rewritten inner type leaves it stranded. `.default()` widens the declared input type with `undefined`, and `optional` is what carries that across.
        default: (s, rewritten) => rewritten ? schemas2.optional(s._zod.def.innerType) : s,
        // A catch value is output-side too, but `.catch()` leaves the declared input type alone, so the inner schema stands on its own.
        catch: (s, rewritten) => rewritten ? s._zod.def.innerType : s
      });
    }
    function output(schema) {
      return (0, visit_js_1.visit)(schema, {
        pipe: (s) => outSide(s._zod.def),
        // A prefault value is fed through the schema, which makes it input-side, so a rewritten inner type leaves it stranded.
        prefault: (s, rewritten) => rewritten ? s._zod.def.innerType : s
      });
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(inOut);
  return inOut;
}
var coerce = {};
var hasRequiredCoerce;
function requireCoerce() {
  if (hasRequiredCoerce) return coerce;
  hasRequiredCoerce = 1;
  (function(exports2) {
    var __createBinding = coerce && coerce.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = coerce && coerce.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = coerce && coerce.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.string = string;
    exports2.number = number;
    exports2.boolean = boolean;
    exports2.bigint = bigint;
    exports2.date = date;
    const core2 = __importStar(/* @__PURE__ */ requireCore());
    const schemas2 = __importStar(/* @__PURE__ */ requireSchemas());
    function string(params) {
      return core2._coercedString(schemas2.ZodString, params);
    }
    function number(params) {
      return core2._coercedNumber(schemas2.ZodNumber, params);
    }
    function boolean(params) {
      return core2._coercedBoolean(schemas2.ZodBoolean, params);
    }
    function bigint(params) {
      return core2._coercedBigint(schemas2.ZodBigInt, params);
    }
    function date(params) {
      return core2._coercedDate(schemas2.ZodDate, params);
    }
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(coerce);
  return coerce;
}
var hasRequiredExternal;
function requireExternal() {
  if (hasRequiredExternal) return external;
  hasRequiredExternal = 1;
  (function(exports2) {
    var __createBinding = external && external.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = external && external.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = external && external.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __exportStar = external && external.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.coerce = exports2.iso = exports2.ZodISODuration = exports2.ZodISOTime = exports2.ZodISODate = exports2.ZodISODateTime = exports2.locales = exports2.output = exports2.input = exports2.deepPartial = exports2.fromJSONSchema = exports2.toJSONSchema = exports2.getDiscriminatedOption = exports2.ZodCompileUnsupportedError = exports2.ZodCompileAsyncError = exports2.withParser = exports2.compile = exports2.toZod = exports2.INVALID = exports2.NEVER = exports2.util = exports2.TimePrecision = exports2.flattenError = exports2.formatError = exports2.prettifyError = exports2.treeifyError = exports2.regexes = exports2.clone = exports2.$brand = exports2.$input = exports2.$output = exports2.memoizer = exports2.config = exports2.registry = exports2.globalRegistry = exports2.core = void 0;
    exports2.core = __importStar(/* @__PURE__ */ requireCore());
    __exportStar(/* @__PURE__ */ requireSchemas(), exports2);
    __exportStar(/* @__PURE__ */ requireChecks(), exports2);
    __exportStar(/* @__PURE__ */ requireErrors(), exports2);
    __exportStar(/* @__PURE__ */ requireParse(), exports2);
    __exportStar(/* @__PURE__ */ requireCompat(), exports2);
    var index_js_1 = /* @__PURE__ */ requireCore();
    Object.defineProperty(exports2, "globalRegistry", { enumerable: true, get: function() {
      return index_js_1.globalRegistry;
    } });
    Object.defineProperty(exports2, "registry", { enumerable: true, get: function() {
      return index_js_1.registry;
    } });
    Object.defineProperty(exports2, "config", { enumerable: true, get: function() {
      return index_js_1.config;
    } });
    Object.defineProperty(exports2, "memoizer", { enumerable: true, get: function() {
      return index_js_1.memoizer;
    } });
    Object.defineProperty(exports2, "$output", { enumerable: true, get: function() {
      return index_js_1.$output;
    } });
    Object.defineProperty(exports2, "$input", { enumerable: true, get: function() {
      return index_js_1.$input;
    } });
    Object.defineProperty(exports2, "$brand", { enumerable: true, get: function() {
      return index_js_1.$brand;
    } });
    Object.defineProperty(exports2, "clone", { enumerable: true, get: function() {
      return index_js_1.clone;
    } });
    Object.defineProperty(exports2, "regexes", { enumerable: true, get: function() {
      return index_js_1.regexes;
    } });
    Object.defineProperty(exports2, "treeifyError", { enumerable: true, get: function() {
      return index_js_1.treeifyError;
    } });
    Object.defineProperty(exports2, "prettifyError", { enumerable: true, get: function() {
      return index_js_1.prettifyError;
    } });
    Object.defineProperty(exports2, "formatError", { enumerable: true, get: function() {
      return index_js_1.formatError;
    } });
    Object.defineProperty(exports2, "flattenError", { enumerable: true, get: function() {
      return index_js_1.flattenError;
    } });
    Object.defineProperty(exports2, "TimePrecision", { enumerable: true, get: function() {
      return index_js_1.TimePrecision;
    } });
    Object.defineProperty(exports2, "util", { enumerable: true, get: function() {
      return index_js_1.util;
    } });
    Object.defineProperty(exports2, "NEVER", { enumerable: true, get: function() {
      return index_js_1.NEVER;
    } });
    Object.defineProperty(exports2, "INVALID", { enumerable: true, get: function() {
      return index_js_1.INVALID;
    } });
    Object.defineProperty(exports2, "toZod", { enumerable: true, get: function() {
      return index_js_1.toZod;
    } });
    Object.defineProperty(exports2, "compile", { enumerable: true, get: function() {
      return index_js_1.compile;
    } });
    Object.defineProperty(exports2, "withParser", { enumerable: true, get: function() {
      return index_js_1.withParser;
    } });
    Object.defineProperty(exports2, "ZodCompileAsyncError", { enumerable: true, get: function() {
      return index_js_1.ZodCompileAsyncError;
    } });
    Object.defineProperty(exports2, "ZodCompileUnsupportedError", { enumerable: true, get: function() {
      return index_js_1.ZodCompileUnsupportedError;
    } });
    Object.defineProperty(exports2, "getDiscriminatedOption", { enumerable: true, get: function() {
      return index_js_1.getDiscriminatedOption;
    } });
    var json_schema_processors_js_1 = /* @__PURE__ */ requireJsonSchemaProcessors();
    Object.defineProperty(exports2, "toJSONSchema", { enumerable: true, get: function() {
      return json_schema_processors_js_1.toJSONSchema;
    } });
    var from_json_schema_js_1 = /* @__PURE__ */ requireFromJsonSchema();
    Object.defineProperty(exports2, "fromJSONSchema", { enumerable: true, get: function() {
      return from_json_schema_js_1.fromJSONSchema;
    } });
    var deep_partial_js_1 = /* @__PURE__ */ requireDeepPartial();
    Object.defineProperty(exports2, "deepPartial", { enumerable: true, get: function() {
      return deep_partial_js_1.deepPartial;
    } });
    var in_out_js_1 = /* @__PURE__ */ requireInOut();
    Object.defineProperty(exports2, "input", { enumerable: true, get: function() {
      return in_out_js_1.input;
    } });
    Object.defineProperty(exports2, "output", { enumerable: true, get: function() {
      return in_out_js_1.output;
    } });
    exports2.locales = __importStar(/* @__PURE__ */ requireLocales());
    var iso_js_1 = /* @__PURE__ */ requireIso();
    Object.defineProperty(exports2, "ZodISODateTime", { enumerable: true, get: function() {
      return iso_js_1.ZodISODateTime;
    } });
    Object.defineProperty(exports2, "ZodISODate", { enumerable: true, get: function() {
      return iso_js_1.ZodISODate;
    } });
    Object.defineProperty(exports2, "ZodISOTime", { enumerable: true, get: function() {
      return iso_js_1.ZodISOTime;
    } });
    Object.defineProperty(exports2, "ZodISODuration", { enumerable: true, get: function() {
      return iso_js_1.ZodISODuration;
    } });
    exports2.iso = __importStar(/* @__PURE__ */ requireIso());
    exports2.coerce = __importStar(/* @__PURE__ */ requireCoerce());
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(external);
  return external;
}
var hasRequiredZod;
function requireZod() {
  if (hasRequiredZod) return zod;
  hasRequiredZod = 1;
  (function(exports2) {
    var __createBinding = zod && zod.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = zod && zod.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = zod && zod.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __exportStar = zod && zod.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = exports2.z = void 0;
    const z = __importStar(/* @__PURE__ */ requireExternal());
    exports2.z = z;
    exports2.default = z;
    __exportStar(/* @__PURE__ */ requireExternal(), exports2);
    (function() {
      var keys = Object.getOwnPropertyNames(exports2);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(exports2, keys[i]);
        if (!desc || !desc.get || !desc.configurable) continue;
        var value;
        try {
          value = desc.get();
        } catch (e) {
          continue;
        }
        if (value === void 0) continue;
        Object.defineProperty(exports2, keys[i], { value, writable: false, enumerable: desc.enumerable, configurable: false });
      }
      Object.freeze(exports2);
    })();
  })(zod);
  return zod;
}
var zodExports = requireZod();
function browserSiteOrigin(raw2) {
  try {
    const url = new URL(raw2);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}
function browserCertificateHost(raw2) {
  try {
    const host2 = raw2.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const url = new URL("https://" + (host2.includes(":") ? "[" + host2 + "]" : host2));
    return url.hostname.replace(/^\[|\]$/g, "") === host2 && url.port === "" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash ? host2 : null;
  } catch {
    return null;
  }
}
const origin = zodExports.z.string().refine((value) => browserSiteOrigin(value) === value, "站点须为规范HTTP(S)来源");
const host = zodExports.z.string().refine((value) => browserCertificateHost(value) === value, "主机名无效");
const browserSiteStateSchema = zodExports.z.object({ schemaVersion: zodExports.z.literal(1), certificates: zodExports.z.array(zodExports.z.object({ host, createdAt: zodExports.z.number().finite() }).strict()), permissions: zodExports.z.array(zodExports.z.object({ origin, permission: zodExports.z.string().min(1).max(120), decision: zodExports.z.enum(["allow", "deny"]), updatedAt: zodExports.z.number().finite() }).strict()) }).strict().superRefine((value, ctx) => {
  if (new Set(value.certificates.map((row) => row.host)).size !== value.certificates.length || new Set(value.permissions.map((row) => JSON.stringify([row.origin, row.permission]))).size !== value.permissions.length) ctx.addIssue({ code: "custom", message: "站点状态重复" });
});
class BrowserNetworkPolicy {
  constructor(options) {
    this.options = options;
    this.sessions = /* @__PURE__ */ new Map();
    this.contents = /* @__PURE__ */ new Map();
    this.suspended = /* @__PURE__ */ new Map();
  }
  endpoint(raw2) {
    try {
      const url = new URL(raw2), host2 = browserCertificateHost(url.hostname);
      return url.protocol === "https:" && host2 ? { endpoint: url.origin, host: host2 } : null;
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
      const state = { profileId, accepted: /* @__PURE__ */ new Map() };
      this.sessions.set(session, state);
      session.webRequest.onBeforeRequest((details, callback) => {
        if (this.suspended.has(profileId)) {
          callback({ cancel: true });
          return;
        }
        const endpoint = this.endpoint(details.url), accepted = endpoint && state.accepted.get(endpoint.endpoint);
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
    const listener = (event, url, error, _certificate, callback, isMainFrame) => {
      event.preventDefault();
      const endpoint = this.endpoint(url), allowed = !contents.isDestroyed() && !this.suspended.has(profileId) && endpoint !== null && this.trusted(profileId, endpoint.host);
      if (endpoint) {
        const failure = { url, host: endpoint.host, error };
        if (allowed) this.sessions.get(session).accepted.set(endpoint.endpoint, failure);
        else if (isMainFrame) try {
          this.options.failed?.(contents, failure);
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
  certificate(contents, url) {
    const scope = this.contents.get(contents), endpoint = this.endpoint(url);
    if (!scope || !endpoint || !this.trusted(scope.profileId, endpoint.host)) return null;
    const accepted = this.sessions.get(contents.session)?.accepted.get(endpoint.endpoint);
    return accepted ? { ...accepted, url } : null;
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
const PACKAGE_OWNER_FILE = ".willyou-package-owner.json";
const APP_HASH_PATTERN = /^[a-f0-9]{64}$/;
const APP_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function isPackagePath(value) {
  if (!value || value !== value.normalize("NFC") || value.length > 1024 || /[\\:\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value)) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
const nativePart = (max) => zodExports.z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(max);
const path = zodExports.z.string().refine(isPackagePath, "应用包路径无效");
const hash = zodExports.z.string().regex(APP_HASH_PATTERN);
const operation = zodExports.z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const api = zodExports.z.number().int().positive();
zodExports.z.object({
  schema: zodExports.z.literal("smartdd-app-package-v1"),
  appId: nativePart(20),
  version: zodExports.z.string().regex(version),
  displayName: zodExports.z.string().trim().min(1).max(120),
  description: zodExports.z.string().max(4e3),
  hostApi: zodExports.z.object({ min: api, max: api }).strict(),
  dataApi: api,
  connectionContracts: zodExports.z.array(zodExports.z.object({
    providerId: zodExports.z.string().regex(APP_ID_PATTERN),
    configApiMajor: api,
    inputSchemaPath: path,
    authModes: zodExports.z.array(zodExports.z.string().min(1).max(80)).min(1),
    identityContractMajor: api
  }).strict()).min(1),
  runtime: zodExports.z.object({ id: zodExports.z.string().regex(APP_ID_PATTERN), hash, protocolMajor: api }).strict(),
  skills: zodExports.z.array(zodExports.z.object({ id: nativePart(16), path, entry: path, description: zodExports.z.string().max(2e3) }).strict()).min(1),
  tools: zodExports.z.array(zodExports.z.object({
    name: zodExports.z.string().regex(/^smartdd_[a-z0-9_]+_v[1-9]\d*$/).max(128),
    contractMajor: api,
    inputSchemaPath: path,
    outputSchemaPath: path,
    permission: operation,
    annotations: zodExports.z.object({ readOnlyHint: zodExports.z.boolean(), destructiveHint: zodExports.z.boolean(), idempotentHint: zodExports.z.boolean(), openWorldHint: zodExports.z.boolean() }).strict()
  }).strict()).min(1),
  adapter: zodExports.z.object({ entry: path, format: zodExports.z.literal("cjs") }).strict(),
  migrations: zodExports.z.array(zodExports.z.object({ id: zodExports.z.string().regex(APP_ID_PATTERN), from: zodExports.z.number().int().nonnegative(), to: api, file: path, checksum: hash }).strict()),
  files: zodExports.z.array(zodExports.z.object({ path, sha256: hash, size: zodExports.z.number().int().nonnegative(), executable: zodExports.z.boolean() }).strict()).min(1).max(4096),
  permissions: zodExports.z.array(operation).min(1)
}).strict().superRefine((manifest, ctx) => {
  const issue = (message) => ctx.addIssue({ code: "custom", message });
  if (manifest.hostApi.min > manifest.hostApi.max) issue("宿主API范围无效");
  const paths = /* @__PURE__ */ new Set(), folded = /* @__PURE__ */ new Set();
  for (const f of manifest.files) {
    if (["manifest.json", PACKAGE_OWNER_FILE].includes(f.path.split("/")[0].toLowerCase()) || paths.has(f.path) || folded.has(f.path.toLowerCase())) issue("包路径重复、大小写冲突或使用保留名称");
    paths.add(f.path);
    folded.add(f.path.toLowerCase());
  }
  const required = [manifest.adapter.entry, ...manifest.connectionContracts.map((c) => c.inputSchemaPath), ...manifest.tools.flatMap((t) => [t.inputSchemaPath, t.outputSchemaPath]), ...manifest.skills.map((s) => s.entry), ...manifest.migrations.map((m) => m.file)];
  if (required.some((p) => !paths.has(p))) issue("包入口或契约未列入完整文件清单");
  for (const f of paths) for (const other of paths) if (other !== f && other.startsWith(f + "/")) issue("文件与目录路径冲突");
  if (new Set(manifest.skills.map((s) => s.id)).size !== manifest.skills.length) issue("Skill标识重复");
  if (manifest.skills.some((s) => !s.entry.startsWith(s.path + "/") || !s.entry.endsWith("/SKILL.md"))) issue("Skill入口必须是本Skill目录内的SKILL.md");
  if (new Set(manifest.tools.map((t) => t.name)).size !== manifest.tools.length) issue("工具名重复");
  if (new Set(manifest.permissions).size !== manifest.permissions.length) issue("动作权限重复");
  const prefix = "smartdd_" + manifest.appId.replaceAll("-", "_") + "_";
  for (const t of manifest.tools) {
    if (!t.name.startsWith(prefix) || !t.name.endsWith("_v" + t.contractMajor)) issue("工具名称与应用及主契约不一致");
    if (!manifest.permissions.includes(t.permission)) issue("工具权限未在包声明中提供");
    if (t.permission.endsWith(".send") && (t.annotations.readOnlyHint || t.annotations.idempotentHint)) issue("发送工具不得声明为只读或幂等");
  }
  const migrations = /* @__PURE__ */ new Set();
  for (let i = 0; i < manifest.migrations.length; i++) {
    const m = manifest.migrations[i];
    if (migrations.has(m.id) || m.to !== m.from + 1 || i && m.from !== manifest.migrations[i - 1].to) issue("应用迁移编号或版本不连续");
    migrations.add(m.id);
    if (manifest.files.find((f) => f.path === m.file)?.sha256 !== m.checksum) issue("迁移checksum与文件清单不一致");
  }
});
class ApplicationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ApplicationError";
  }
}
class BrowserSiteStates {
  constructor(db2, knownProfile) {
    this.db = db2;
    this.knownProfile = knownProfile;
    this.states = /* @__PURE__ */ new Map();
  }
  key(id2) {
    return "browserProfileState.v1:" + id2;
  }
  read(id2) {
    if (!this.knownProfile(id2)) throw new ApplicationError("SCOPE_DENIED", "登录态不存在");
    const cached = this.states.get(id2);
    if (cached) return cached;
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key=?").get(this.key(id2));
    let state;
    try {
      if (row && Buffer.byteLength(row.value) > 4 * 1024 * 1024) throw Error();
      state = row ? browserSiteStateSchema.parse(JSON.parse(row.value)) : { schemaVersion: 1, certificates: [], permissions: [] };
    } catch {
      throw new ApplicationError("BROWSER_UNAVAILABLE", "站点授权记录损坏；原记录已保留");
    }
    this.states.set(id2, state);
    return state;
  }
  snapshot(id2) {
    const state = this.read(id2);
    return { ...state, certificates: state.certificates.map((row) => ({ ...row })), permissions: state.permissions.map((row) => ({ ...row })) };
  }
  save(id2, state) {
    const parsed = browserSiteStateSchema.parse(state), value = JSON.stringify(parsed);
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
    const state = this.read(id2);
    this.save(id2, { ...state, certificates: [...state.certificates.filter((row) => row.host !== host2), { host: host2, createdAt: Date.now() }] });
  }
  revokeCertificate(id2, hostname) {
    const host2 = browserCertificateHost(hostname);
    if (!host2) throw new ApplicationError("INVALID_INPUT", "主机名无效");
    const state = this.read(id2);
    this.save(id2, { ...state, certificates: state.certificates.filter((row) => row.host !== host2) });
  }
  permission(id2, url, name) {
    const origin2 = browserSiteOrigin(url);
    if (origin2 === null) return null;
    return this.read(id2).permissions.find((row) => row.origin === origin2 && row.permission === name)?.decision ?? null;
  }
  decide(id2, url, names, decision) {
    const origin2 = browserSiteOrigin(url);
    if (origin2 === null || !names.length || names.length > 16 || names.some((name) => !name || name.length > 120)) throw new ApplicationError("INVALID_INPUT", "站点权限请求无效");
    const state = this.read(id2), permissions = state.permissions.filter((row) => row.origin !== origin2 || !names.includes(row.permission));
    for (const permission of new Set(names)) permissions.push({ origin: origin2, permission, decision, updatedAt: Date.now() });
    this.save(id2, { ...state, permissions });
  }
  revokePermission(id2, url, permission) {
    const origin2 = browserSiteOrigin(url);
    if (origin2 === null) throw new ApplicationError("INVALID_INPUT", "站点无效");
    const state = this.read(id2);
    this.save(id2, { ...state, permissions: state.permissions.filter((row) => row.origin !== origin2 || row.permission !== permission) });
  }
  forget(id2) {
    this.db.prepare("DELETE FROM app_settings WHERE key=?").run(this.key(id2));
    this.states.delete(id2);
  }
}
const { HOST, RULE, html } = require("/private/tmp/willyou-m12-p012-executor-001/certificate-fixture.cjs");
const root = "/private/tmp/willyou-m12-p012-executor-001", config = JSON.parse(fs.readFileSync(process.argv.at(-1), "utf8")), write = (name, value) => fs.writeFileSync(path$1.join(root, name), JSON.stringify(value, null, 2) + "\n");
if (config.root !== root || config.host !== HOST || config.dnsRule !== RULE) throw Error("Exact private config required");
if (process.versions.electron !== "42.11.14" || process.versions.modules !== "146") throw Error("Pinned runtime required");
electron.app.commandLine.appendSwitch("host-resolver-rules", RULE);
electron.app.setPath("userData", config.userData);
for (const flag of ["ignore-certificate-errors", "allow-insecure-localhost", "disable-web-security"]) if (electron.app.commandLine.hasSwitch(flag)) throw Error("Forbidden TLS relaxation");
const now = () => (/* @__PURE__ */ new Date()).toISOString(), windows = [], sockets = /* @__PURE__ */ new Set(), requestRows = [], events = [], failed = [], raw = { group: "M12-P012", scope: "Actual production components technical I only; App assembly and T012 A are not under test", pid: process.pid, startedAt: now(), versions: process.versions, dns: { host: HOST, rule: RULE, switch: electron.app.commandLine.getSwitchValue("host-resolver-rules") }, steps: [], requests: requestRows, events, failed }, cleanup = {};
let tlsServer, httpServer, ports, db, states, policy;
const known = /* @__PURE__ */ new Set(["profile-A", "profile-B"]);
const nativeSessions = [];
function observer(win, profileId) {
  const onCertificate = (_event, url, error, cert, _callback, main) => events.push({ at: now(), kind: "certificate-error-observed-only", profileId, wcId: win.webContents.id, url, error, fingerprint: new node_crypto.X509Certificate(cert.data).fingerprint256, isMainFrame: main });
  win.webContents.on("certificate-error", onCertificate);
  return onCertificate;
}
const observers = /* @__PURE__ */ new Map();
function windowFor(ses, profileId, label) {
  const win = new electron.BrowserWindow({ show: false, focusable: false, skipTaskbar: true, width: 850, height: 550, title: "[I] P012 " + label, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
  windows.push(win);
  raw.windows ??= [];
  raw.windows.push({ at: now(), id: win.id, wcId: win.webContents.id, profileId, label, baselineCertificateListeners: win.webContents.listenerCount("certificate-error"), baselineDestroyedListeners: win.webContents.listenerCount("destroyed") });
  policy.install(win.webContents, profileId);
  observers.set(win, observer(win, profileId));
  return win;
}
function saved() {
  return { memoryA: states.snapshot("profile-A"), memoryB: states.snapshot("profile-B"), persisted: db.prepare("SELECT key,value,updated_at FROM app_settings ORDER BY key").all(), reloadedTrustedA: new BrowserSiteStates(db, (id2) => known.has(id2)).trusted("profile-A", HOST), reloadedTrustedB: new BrowserSiteStates(db, (id2) => known.has(id2)).trusted("profile-B", HOST) };
}
async function nav(win, profileId, step, protocol = "https", seed = false) {
  const url = protocol + "://" + HOST + ":" + ports[protocol] + "/doc?step=" + encodeURIComponent(step) + (seed ? "&seed=1" : ""), row = { step, profileId, protocol, url, wcId: win.webContents.id, startedAt: now(), failureStart: failed.length, eventStart: events.length };
  let timer;
  try {
    await Promise.race([win.loadURL(url), new Promise((_ok, no2) => {
      timer = setTimeout(() => {
        win.webContents.stop();
        no2(Error("8s navigation deadline"));
      }, 8e3);
    })]);
    row.outcome = "loaded";
    row.document = await win.webContents.executeJavaScript('({url:location.href,local:localStorage.getItem("p012-marker"),step:window.p012Step??null})');
  } catch (error) {
    row.outcome = "blocked-or-failed";
    row.error = { message: String(error.message ?? error), code: error.code ?? null, errno: error.errno ?? null };
  } finally {
    clearTimeout(timer);
  }
  row.finishedAt = now();
  row.failed = failed.slice(row.failureStart);
  row.events = events.slice(row.eventStart);
  row.serverRequests = requestRows.filter((q) => q.url === url);
  row.saved = saved();
  row.certificateStatus = policy.certificate(win.webContents, url);
  raw.steps.push(row);
  write("navigation-" + step + ".raw.json", row);
  write("live.json", raw);
  process.send?.({ stage: "navigation", step, outcome: row.outcome });
  return row;
}
async function sessionFetch(ses, step) {
  const url = "http://" + HOST + ":" + ports.http + "/fetch?step=" + step;
  const row = { step, kind: "session-fetch-no-webcontents", url, startedAt: now() };
  try {
    const response = await ses.fetch(url);
    await response.text();
    row.outcome = "loaded";
    row.status = response.status;
  } catch (error) {
    row.outcome = "blocked-or-failed";
    row.error = String(error.message ?? error);
  }
  row.serverRequests = requestRows.filter((q) => q.url === url);
  raw.steps.push(row);
  write("fetch-" + step + ".raw.json", row);
  return row;
}
async function rendererFetch(win, step) {
  const url = "https://" + HOST + ":" + ports.https + "/fetch?step=" + step;
  const expression = "fetch(" + JSON.stringify(url) + ',{cache:"no-store"}).then(async response=>{await response.text();return {ok:response.ok,status:response.status}}).catch(error=>({ok:false,error:String(error)}))';
  const value = await win.webContents.executeJavaScript(expression);
  const row = { step, kind: "same-origin-renderer-fetch", url, wcId: win.webContents.id, value, serverRequests: requestRows.filter((q) => q.url === url) };
  raw.steps.push(row);
  write("fetch-" + step + ".raw.json", row);
  return row;
}
async function data(view, ses) {
  return { at: now(), local: await view.webContents.executeJavaScript('({url:location.href,local:localStorage.getItem("p012-marker")})'), cookies: await ses.cookies.get({ url: "https://" + HOST + ":" + ports.https }) };
}
function mutation(label, action) {
  const value = action();
  const row = { step: label, at: now(), kind: "synthetic trusted-UI authorization precondition or actual policy lifecycle operation", saved: saved() };
  raw.steps.push(row);
  write("mutation-" + label + ".raw.json", row);
  return value;
}
electron.app.whenReady().then(async () => {
  try {
    db = new Database(path$1.join(config.userData, "site-state.sqlite"));
    db.exec("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)");
    states = new BrowserSiteStates(db, (id2) => known.has(id2));
    policy = new BrowserNetworkPolicy({ trusted: (profile, host2) => states.trusted(profile, host2), failed: (contents, failure) => failed.push({ at: now(), wcId: contents.id, ...failure }) });
    const respond = (protocol) => (request, response) => {
      const url = new URL(request.url, protocol + "://" + HOST + ":" + ports[protocol]), step = url.searchParams.get("step"), seed = url.searchParams.get("seed") === "1", socket = request.socket;
      requestRows.push({ at: now(), protocol, url: protocol + "://" + request.headers.host + request.url, cookie: request.headers.cookie ?? "", remoteAddress: socket.remoteAddress, sni: socket.servername ?? null });
      response.setHeader("cache-control", "no-store");
      if (seed && protocol === "https") response.setHeader("set-cookie", "p012_marker=p012-login-A; Path=/; Secure; HttpOnly; SameSite=Lax");
      const body = html({ step, seed });
      response.setHeader("content-type", "text/html;charset=utf-8");
      response.setHeader("content-length", Buffer.byteLength(body));
      response.end(body);
    };
    tlsServer = https.createServer({ key: fs.readFileSync(config.key), cert: fs.readFileSync(config.cert) }, respond("https"));
    httpServer = http.createServer(respond("http"));
    for (const server of [tlsServer, httpServer]) {
      server.keepAliveTimeout = 3e4;
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
    }
    tlsServer.on("tlsClientError", (error) => events.push({ at: now(), kind: "server-tls-error", error: error.message }));
    await new Promise((ok) => tlsServer.listen(0, "127.0.0.1", ok));
    await new Promise((ok) => httpServer.listen(0, "127.0.0.1", ok));
    ports = { https: tlsServer.address().port, http: httpServer.address().port };
    raw.ports = ports;
    raw.certificate = { fingerprint: new node_crypto.X509Certificate(fs.readFileSync(config.cert)).fingerprint256, subjectAltName: new node_crypto.X509Certificate(fs.readFileSync(config.cert)).subjectAltName };
    process.send?.({ ready: true, pid: process.pid, port: ports.https, ports, versions: process.versions, dns: raw.dns });
    const partA = "persist:p012-A-" + node_crypto.randomUUID(), partB = "persist:p012-B-" + node_crypto.randomUUID(), sesA = electron.session.fromPartition(partA), sesB = electron.session.fromPartition(partB);
    raw.partitions = [{ profileId: "profile-A", partition: partA }, { profileId: "profile-B", partition: partB }];
    nativeSessions.push(sesA, sesB);
    await sesA.setProxy({ mode: "direct" });
    await sesB.setProxy({ mode: "direct" });
    const main = windowFor(sesA, "profile-A", "A navigation"), view = windowFor(sesA, "profile-A", "A state readback"), other = windowFor(sesB, "profile-B", "B isolated");
    raw.defaultState = saved();
    await nav(main, "profile-A", "default-denied");
    mutation("trust-A", () => states.trust("profile-A", HOST));
    await nav(main, "profile-A", "allowed-seed", "https", true);
    await nav(view, "profile-A", "allowed-state-view");
    raw.before = await data(view, sesA);
    await nav(other, "profile-B", "isolated-B-while-A-trusted");
    raw.isolatedCookies = await sesB.cookies.get({});
    mutation("revoke-A", () => states.revokeCertificate("profile-A", HOST));
    await nav(main, "profile-A", "revoked-warm");
    raw.afterWarm = await data(view, sesA);
    await sesA.closeAllConnections();
    raw.steps.push({ step: "close-A-connections", at: now() });
    await nav(main, "profile-A", "revoked-fresh");
    raw.afterFresh = await data(view, sesA);
    const first = mutation("suspend-outer", () => policy.suspend("profile-A")), second = mutation("suspend-inner", () => policy.suspend("profile-A"));
    const plain = windowFor(sesA, "profile-A", "A new during suspension");
    await nav(main, "profile-A", "nested-two-https");
    await nav(plain, "profile-A", "nested-two-http", "http");
    await sessionFetch(sesA, "nested-two-session-http");
    mutation("release-outer", first);
    await nav(main, "profile-A", "nested-one-https");
    await nav(plain, "profile-A", "nested-one-http", "http");
    await sessionFetch(sesA, "nested-one-session-http");
    mutation("release-inner", second);
    await nav(plain, "profile-A", "all-released-http", "http");
    await sessionFetch(sesA, "all-released-session-http");
    await nav(main, "profile-A", "all-released-still-revoked");
    await rendererFetch(view, "all-released-renderer-still-revoked");
    raw.afterSuspension = await data(view, sesA);
    mutation("retrust-A", () => states.trust("profile-A", HOST));
    await nav(main, "profile-A", "retrusted");
    await rendererFetch(view, "retrusted-renderer");
    raw.afterRetrust = await data(view, sesA);
    raw.finalState = saved();
    raw.status = "executed";
  } catch (error) {
    raw.status = "failed";
    raw.failure = String(error.stack ?? error);
  } finally {
    for (const [win, listener] of observers) if (!win.isDestroyed()) win.webContents.off("certificate-error", listener);
    if (policy) policy.dispose();
    cleanup.productionListenersAfterDispose = windows.filter((win) => !win.isDestroyed()).map((win) => ({ windowId: win.id, wcId: win.webContents.id, certificateListeners: win.webContents.listenerCount("certificate-error"), destroyedListeners: win.webContents.listenerCount("destroyed"), baseline: raw.windows.find((row) => row.id === win.id) }));
    cleanup.windows = windows.map((win) => {
      if (!win.isDestroyed()) win.destroy();
      return { id: win.id, destroyed: win.isDestroyed() };
    });
    for (const ses of nativeSessions) await ses.closeAllConnections().catch(() => {
    });
    for (const socket of sockets) socket.destroy();
    cleanup.servers = [];
    for (const server of [tlsServer, httpServer]) if (server) {
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
      cleanup.servers.push({ closed: true });
    }
    if (db) {
      raw.finalDatabaseRows = db.prepare("SELECT key,value,updated_at FROM app_settings ORDER BY key").all();
      db.close();
      cleanup.sqliteClosed = true;
    }
    cleanup.finishedAt = now();
    raw.cleanup = cleanup;
    raw.finishedAt = cleanup.finishedAt;
    write("probe.raw.json", raw);
    write("host-cleanup.json", cleanup);
    process.send?.({ complete: true, status: raw.status });
    electron.app.quit();
  }
});
electron.app.on("window-all-closed", () => {
});
