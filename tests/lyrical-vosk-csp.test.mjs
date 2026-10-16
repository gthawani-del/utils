import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { patchVoskCsp } from "../scripts/lyrical-vosk-csp.mjs";

async function wrappers(globals = {}) {
  const library = await readFile(new URL("../node_modules/vosk-browser/dist/vosk.js", import.meta.url), "utf8");
  const original = Buffer.from(library.match(/createBase64WorkerFactory\(['"]([A-Za-z0-9+/=]+)['"]/)[1], "base64").toString("utf8");
  const source = patchVoskCsp(original);
  const ranges = [
    ["function createNamedFunction(", "var emval_free_list="],
    ["function craftInvokerFunction(", "function heap32VectorToArray("],
    ["function __emval_get_method_caller(", "function __emval_incref("],
  ];
  const code = ranges.map(([start, end]) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))).join("\n");
  const context = vm.createContext({
    makeLegalFunctionName: name => name.replace(/\W/g, "_"),
    throwBindingError: message => { throw new Error(message); },
    runDestructors: stack => { for (const cleanup of stack) cleanup(); },
    ...globals,
  }, { codeGeneration: { strings: false, wasm: true } });
  vm.runInContext(code, context);
  assert.throws(() => vm.runInContext("new Function('return 1')()", context), /Code generation from strings disallowed/);
  return context;
}

test("Vosk CSP wrappers preserve method this, wire values, destructors and return values without eval", async () => {
  const context = await wrappers(), cleanup = [];
  const types = [
    { name: "number", fromWireType: x => x + 1 },
    { toWireType: (_, self) => self.id, destructorFunction: x => cleanup.push(["self", x]) },
    { toWireType: (_, x) => x * 2, destructorFunction: x => cleanup.push(["arg", x]) },
  ];
  const invoke = context.craftInvokerFunction("Recognizer.test", types, {}, (fn, self, arg) => fn(self, arg), (self, arg) => self + arg);
  assert.equal(invoke.call({ id: 10 }, 5), 21);
  assert.equal(invoke.name, "Recognizer_test");
  assert.equal(invoke.length, 1);
  assert.deepEqual(cleanup, [["self", 10], ["arg", 10]]);
  assert.throws(() => invoke(), /expected 1/);
});

test("Vosk CSP wrappers support static calls, destructor stacks and void returns", async () => {
  const context = await wrappers();
  let cleaned = false, called;
  const types = [{ name: "void" }, null, {
    toWireType(stack, value) { stack.push(() => { cleaned = true; }); return value + 4; },
  }];
  const invoke = context.craftInvokerFunction("free", types, null, (fn, arg) => fn(arg), value => { called = value; });
  assert.equal(invoke(3), undefined);
  assert.equal(called, 7);
  assert.equal(cleaned, true);
});

test("Vosk CSP JavaScript callbacks preserve argument offsets, receiver and object cleanup", async () => {
  const deleted = [], destructors = [];
  const types = [
    { isVoid: false, toWireType: (stack, value) => { stack.push("return"); return value * 2; } },
    { argPackAdvance: 8, readValueFromPointer: ptr => ptr, deleteObject: value => deleted.push(value) },
    { argPackAdvance: 8, readValueFromPointer: ptr => ptr, deleteObject: value => deleted.push(value) },
  ];
  const context = await wrappers({ __emval_lookupTypes: () => types, __emval_addMethodCaller: fn => fn });
  const invoke = context.__emval_get_method_caller(3, 0);
  const receiver = { value: 5, sum(a, b) { return this.value + a + b; } };
  assert.equal(invoke(receiver, "sum", destructors, 100), 426);
  assert.deepEqual(deleted, [100, 108]);
  assert.deepEqual(destructors, ["return"]);
});
