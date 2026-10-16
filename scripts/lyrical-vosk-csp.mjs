// Ordinary-function equivalents of the three dynamic Embind wrappers in the
// hash-pinned Vosk worker. Keep argument conversion, `this`, return conversion,
// and destructor behavior; do not enable JavaScript string compilation.
export function patchVoskCsp(worker) {
  function replace(from, to, body) {
    const start = worker.indexOf(from), end = worker.indexOf(to, start);
    if (start < 0 || end < 0) throw new Error("Pinned Vosk wrapper not found: " + from);
    worker = worker.slice(0, start) + body + worker.slice(end);
  }
  replace("function createNamedFunction(name,body){", "var emval_free_list=",
    'function createNamedFunction(name,body){var fn=function(){return body.apply(this,arguments)};Object.defineProperty(fn,"name",{value:makeLegalFunctionName(name),configurable:true});return fn}');
  replace("function craftInvokerFunction(", "function heap32VectorToArray(", `
function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){
  var argCount=argTypes.length;
  if(argCount<2)throwBindingError("argTypes array size mismatch");
  var isMethod=argTypes[1]!==null&&classType!==null;
  var needsStack=argTypes.slice(1).some(function(type){return type!==null&&type.destructorFunction===undefined});
  var fn=createNamedFunction(humanName,function(){
    if(arguments.length!==argCount-2)throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+(argCount-2));
    var destructors=needsStack?[]:null;
    var wired=[cppTargetFunc];
    if(isMethod)wired.push(argTypes[1].toWireType(destructors,this));
    for(var i=0;i<arguments.length;i++)wired.push(argTypes[i+2].toWireType(destructors,arguments[i]));
    var result=cppInvokerFunc.apply(null,wired);
    if(needsStack)runDestructors(destructors);
    else for(var i=isMethod?1:2;i<argCount;i++){
      if(argTypes[i].destructorFunction!==null)argTypes[i].destructorFunction(wired[isMethod?i:i-1]);
    }
    if(argTypes[0].name!=="void")return argTypes[0].fromWireType(result);
  });
  Object.defineProperty(fn,"length",{value:argCount-2,configurable:true});
  return fn;
}
`);
  replace("function __emval_get_method_caller(", "function __emval_incref(", `
function __emval_get_method_caller(argCount,argTypes){
  var types=__emval_lookupTypes(argCount,argTypes),retType=types[0];
  var fn=function(handle,name,destructors,args){
    var values=[],offset=0;
    for(var i=1;i<argCount;i++){
      values.push(types[i].readValueFromPointer(args+offset));
      offset+=types[i].argPackAdvance;
    }
    var result=handle[name].apply(handle,values);
    for(var i=1;i<argCount;i++)if(types[i].deleteObject)types[i].deleteObject(values[i-1]);
    if(!retType.isVoid)return retType.toWireType(destructors,result);
  };
  return __emval_addMethodCaller(fn);
}
`);
  if (/\bnew\s+Function\b|\beval\s*\(|new_\s*\(\s*Function/.test(worker))
    throw new Error("Vosk runtime still constructs JavaScript dynamically");
  return worker;
}
