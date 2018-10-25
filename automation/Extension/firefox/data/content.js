
function getPageScript() {
  // Intrumentation injection code is based on privacybadgerfirefox
  // https://github.com/EFForg/privacybadgerfirefox/blob/master/data/fingerprinting.js

  // code below is not a content script: no Firefox APIs should be used

  // return a string
  return "(" + function () {
    // from Underscore v1.6.0
    function debounce(func, wait, immediate) {
      var timeout, args, context, timestamp, result;

      var later = function () {
        var last = Date.now() - timestamp;
        if (last < wait) {
          timeout = setTimeout(later, wait - last);
        } else {
          timeout = null;
          if (!immediate) {
            result = func.apply(context, args);
            context = args = null;
          }
        }
      };

      return function () {
        context = this;
        args = arguments;
        timestamp = Date.now();
        var callNow = immediate && !timeout;
        if (!timeout) {
          timeout = setTimeout(later, wait);
        }
        if (callNow) {
          result = func.apply(context, args);
          context = args = null;
        }

        return result;
      };
    }
    // End of Debounce

    // messages the injected script
    var send = (function () {
      var messages = [];
      // debounce sending queued messages
      var _send = debounce(function () {
        document.dispatchEvent(new CustomEvent(event_id, {
          detail: messages
        }));

        // clear the queue
        messages = [];
      }, 100);

      return function (msgType, msg) {
        // queue the message
        messages.push({'type':msgType,'content':msg});
        _send();
      };
    }());

    var event_id = document.currentScript.getAttribute('data-event-id');

    /*
     * Instrumentation helpers
     */

    var testing = document.currentScript.getAttribute('data-testing') === 'true';
    console.log("Currently testing?",testing);

    // Recursively generates a path for an element
    function getPathToDomElement(element, visibilityAttr=false) {
      if(element == document.body)
        return element.tagName;
      if(element.parentNode == null)
        return 'NULL/' + element.tagName;

      var siblingIndex = 1;
      var siblings = element.parentNode.childNodes;
      for (var i = 0; i < siblings.length; i++) {
        var sibling = siblings[i];
        if (sibling == element) {
          var path = getPathToDomElement(element.parentNode, visibilityAttr);
          path += '/' + element.tagName + '[' + siblingIndex;
          path += ',' + element.id;
          path += ',' + element.className;
          if (visibilityAttr) {
            path += ',' + element.hidden;
            path += ',' + element.style.display;
            path += ',' + element.style.visibility;
          }
          if(element.tagName == 'A')
            path += ',' + element.href;
          path += ']';
          return path;
        }
        if (sibling.nodeType == 1 && sibling.tagName == element.tagName)
          siblingIndex++;
      }
    }

    // Helper for JSONifying objects
    function serializeObject(object, stringifyFunctions=false) {

      // Handle permissions errors
      try {
        if(object == null)
          return "null";
        if(typeof object == "function") {
          if (stringifyFunctions)
            return object.toString();
          else
            return "FUNCTION";
        }
        if(typeof object != "object")
          return object;
        var seenObjects = [];
        return JSON.stringify(object, function(key, value) {
          if(value == null)
            return "null";
          if(typeof value == "function") {
            if (stringifyFunctions)
              return value.toString();
            else
              return "FUNCTION";
          }
          if(typeof value == "object") {
            // Remove wrapping on content objects
            if("wrappedJSObject" in value) {
              value = value.wrappedJSObject;
            }

            // Serialize DOM elements
            if(value instanceof HTMLElement)
              return getPathToDomElement(value);

            // Prevent serialization cycles
            if(key == "" || seenObjects.indexOf(value) < 0) {
              seenObjects.push(value);
              return value;
            }
            else
              return typeof value;
          }
          return value;
        });
      } catch(error) {
        console.log("SERIALIZATION ERROR: " + error);
        return "SERIALIZATION ERROR: " + error;
      }
    }

    function logErrorToConsole(error) {
      console.log("Error name: " + error.name);
      console.log("Error message: " + error.message);
      console.log("Error filename: " + error.fileName);
      console.log("Error line number: " + error.lineNumber);
      console.log("Error stack: " + error.stack);
    }

    // Helper to get originating script urls
    function getStackTrace() {
      var stack;

      try {
        throw new Error();
      } catch (err) {
        stack = err.stack;
      }

      return stack;
    }

    // from http://stackoverflow.com/a/5202185
    String.prototype.rsplit = function(sep, maxsplit) {
      var split = this.split(sep);
      return maxsplit ? [split.slice(0, -maxsplit).join(sep)].concat(split.slice(-maxsplit)) : split;
    }

    function getOriginatingScriptContext(getCallStack=false) {
      var trace = getStackTrace().trim().split('\n');
      // return a context object even if there is an error
      var empty_context = {scriptUrl: "",scriptLine: "",
                           scriptCol: "", funcName: "",
                           scriptLocEval: "", callStack: "" };
      if (trace.length < 4) {
        return empty_context;
      }
      // 0, 1 and 2 are OpenWPM's own functions (e.g. getStackTrace), skip them.
      var callSite = trace[3];
      if (!callSite){
        return empty_context;
      }
      /*
       * Stack frame format is simply: FUNC_NAME@FILENAME:LINE_NO:COLUMN_NO
       *
       * If eval or Function is involved we have an additional part after the FILENAME, e.g.:
       * FUNC_NAME@FILENAME line 123 > eval line 1 > eval:LINE_NO:COLUMN_NO
       * or FUNC_NAME@FILENAME line 234 > Function:LINE_NO:COLUMN_NO
       *
       * We store the part between the FILENAME and the LINE_NO in scriptLocEval
       */
      try{
        var scriptUrl = "";
        var scriptLocEval = ""; // for eval or Function calls
        var callSiteParts = callSite.split("@");
        var funcName = callSiteParts[0] || '';
        var items = callSiteParts[1].rsplit(":", 2);
        var columnNo = items[items.length-1];
        var lineNo = items[items.length-2];
        var scriptFileName = items[items.length-3] || '';
        var lineNoIdx = scriptFileName.indexOf(" line ");  // line in the URL means eval or Function
        if (lineNoIdx == -1){
          scriptUrl = scriptFileName;  // TODO: sometimes we have filename only, e.g. XX.js
        }else{
          scriptUrl = scriptFileName.slice(0, lineNoIdx);
          scriptLocEval = scriptFileName.slice(lineNoIdx+1, scriptFileName.length);
        }
        var callContext = {
          scriptUrl: scriptUrl,
          scriptLine: lineNo,
          scriptCol: columnNo,
          funcName: funcName,
          scriptLocEval: scriptLocEval,
          callStack: getCallStack ? trace.slice(3).join("\n").trim() : ""
        };
        return callContext;
      } catch (e) {
        console.log("Error parsing the script context", e, callSite);
        return empty_context;
      }
    }

    // Counter to cap # of calls logged for each script/api combination
    var maxLogCount = 500;
    var logCounter = new Object();
    function updateCounterAndCheckIfOver(scriptUrl, symbol) {
      var key = scriptUrl + '|' + symbol;
      if ((key in logCounter) && (logCounter[key] >= maxLogCount)) {
        return true;
      } else if (!(key in logCounter)) {
        logCounter[key] = 1;
      } else {
        logCounter[key] += 1;
      }
      return false;
    }

    // Prevent logging of gets arising from logging
    var inLog = false;

    // For gets, sets, etc. on a single value
    function logValue(instrumentedVariableName, value, operation, callContext, logSettings) {
      if(inLog)
        return;
      inLog = true;

      var overLimit = updateCounterAndCheckIfOver(callContext.scriptUrl, instrumentedVariableName);
      if (overLimit) {
        inLog = false;
        return;
      }

      var msg = {
        operation: operation,
        symbol: instrumentedVariableName,
        value: serializeObject(value, !!logSettings.logFunctionsAsStrings),
        scriptUrl: callContext.scriptUrl,
        scriptLine: callContext.scriptLine,
        scriptCol: callContext.scriptCol,
        funcName: callContext.funcName,
        scriptLocEval: callContext.scriptLocEval,
        callStack: callContext.callStack
      };

      try {
        send('logValue', msg);
      }
      catch(error) {
        console.log("Unsuccessful value log!");
        logErrorToConsole(error);
      }

      inLog = false;
    }

    // For functions
    function logCall(instrumentedFunctionName, args, callContext, logSettings) {
      if(inLog)
        return;
      inLog = true;

      var overLimit = updateCounterAndCheckIfOver(callContext.scriptUrl, instrumentedFunctionName);
      if (overLimit) {
        inLog = false;
        return;
      }

      try {
        // Convert special arguments array to a standard array for JSONifying
        var serialArgs = [ ];
        for(var i = 0; i < args.length; i++)
          serialArgs.push(serializeObject(args[i], !!logSettings.logFunctionsAsStrings));
        var msg = {
          operation: "call",
          symbol: instrumentedFunctionName,
          args: serialArgs,
          value: "",
          scriptUrl: callContext.scriptUrl,
          scriptLine: callContext.scriptLine,
          scriptCol: callContext.scriptCol,
          funcName: callContext.funcName,
          scriptLocEval: callContext.scriptLocEval,
          callStack: callContext.callStack
        }
        send('logCall', msg);
      }
      catch(error) {
        console.log("Unsuccessful call log: " + instrumentedFunctionName);
        logErrorToConsole(error);
      }
      inLog = false;
    }

    // Rough implementations of Object.getPropertyDescriptor and Object.getPropertyNames
    // See http://wiki.ecmascript.org/doku.php?id=harmony:extended_object_api
    Object.getPropertyDescriptor = function (subject, name) {
      var pd = Object.getOwnPropertyDescriptor(subject, name);
      var proto = Object.getPrototypeOf(subject);
      while (pd === undefined && proto !== null) {
        pd = Object.getOwnPropertyDescriptor(proto, name);
        proto = Object.getPrototypeOf(proto);
      }
      return pd;
    };

    Object.getPropertyNames = function (subject, name) {
      var props = Object.getOwnPropertyNames(subject);
      var proto = Object.getPrototypeOf(subject);
      while (proto !== null) {
        props = props.concat(Object.getOwnPropertyNames(proto));
        proto = Object.getPrototypeOf(proto);
      }
      // FIXME: remove duplicate property names from props
      return props;
    };

    /*
     *  Direct instrumentation of javascript objects
     */

    function isObject(object, propertyName) {
      try {
        var property = object[propertyName];
      } catch(error) {
        return false;
      }
      if (property === null) { // null is type "object"
        return false;
      }
      return typeof property === 'object';
    }

    function instrumentObject(object, objectName, logSettings={}) {
      // Use for objects or object prototypes
      //
      // Parameters
      // ----------
      //   object : Object
      //     Object to instrument
      //   objectName : String
      //     Name of the object to be instrumented (saved to database)
      //   logSettings : Object
      //     (optional) object that can be used to specify additional logging
      //     configurations. See available options below.
      //
      // logSettings options (all optional)
      // -------------------
      //   propertiesToInstrument : Array
      //     An array of properties to instrument on this object. Default is
      //     all properties.
      //   excludedProperties : Array
      //     Properties excluded from instrumentation. Default is an empty
      //     array.
      //   logCallStack : boolean
      //     Set to true save the call stack info with each property call.
      //     Default is `false`.
      //   logFunctionsAsStrings : boolean
      //     Set to true to save functional arguments as strings during
      //     argument serialization. Default is `false`.
      //   preventSets : boolean
      //     Set to true to prevent nested objects and functions from being
      //     overwritten (and thus having their instrumentation removed).
      //     Other properties (static values) can still be set with this is
      //     enabled. Default is `false`.
      //   recursive : boolean
      //     Set to `true` to recursively instrument all object properties of
      //     the given `object`. Default is `false`
      //     NOTE:
      //       (1)`logSettings['propertiesToInstrument']` does not propagate
      //           to sub-objects.
      //       (2) Sub-objects of prototypes can not be instrumented
      //           recursively as these properties can not be accessed
      //           until an instance of the prototype is created.
      //   depth : integer
      //     Recursion limit when instrumenting object recursively.
      //     Default is `5`.
      var properties = logSettings.propertiesToInstrument ?
        logSettings.propertiesToInstrument : Object.getPropertyNames(object);
      for (var i = 0; i < properties.length; i++) {
        if (logSettings.excludedProperties &&
            logSettings.excludedProperties.indexOf(properties[i]) > -1) {
          continue;
        }
        // If `recursive` flag set we want to recursively instrument any
        // object properties that aren't the prototype object. Only recurse if
        // depth not set (at which point its set to default) or not at limit.
        if (!!logSettings.recursive && properties[i] != '__proto__' &&
            isObject(object, properties[i]) &&
            (!('depth' in logSettings) || logSettings.depth > 0)) {

          // set recursion limit to default if not specified
          if (!('depth' in logSettings)) {
            logSettings['depth'] = 5;
          }
          instrumentObject(object[properties[i]], objectName + '.' + properties[i], {
                'excludedProperties': logSettings['excludedProperties'],
                'logCallStack': logSettings['logCallStack'],
                'logFunctionsAsStrings': logSettings['logFunctionsAsStrings'],
                'preventSets': logSettings['preventSets'],
                'recursive': logSettings['recursive'],
                'depth': logSettings['depth'] - 1
          });
        }
        try {
          instrumentObjectProperty(object, objectName, properties[i], logSettings);
        } catch(error) {
          logErrorToConsole(error);
        }
      }
    }
    if (testing) {
      window.instrumentObject = instrumentObject;
    }

    // Log calls to a given function
    // This helper function returns a wrapper around `func` which logs calls
    // to `func`. `objectName` and `methodName` are used strictly to identify
    // which object method `func` is coming from in the logs
    function instrumentFunction(objectName, methodName, func, logSettings) {
      return function () {
        var callContext = getOriginatingScriptContext(!!logSettings.logCallStack);
        logCall(objectName + '.' + methodName, arguments, callContext, logSettings);
        return func.apply(this, arguments);
      };
    }

    // Log properties of prototypes and objects
    function instrumentObjectProperty(object, objectName, propertyName, logSettings={}) {

      // Store original descriptor in closure
      var propDesc = Object.getPropertyDescriptor(object, propertyName);
      if (!propDesc){
        console.error("Property descriptor not found for", objectName, propertyName, object);
        return;
      }

      // Instrument data or accessor property descriptors
      var originalGetter = propDesc.get;
      var originalSetter = propDesc.set;
      var originalValue = propDesc.value;

      // We overwrite both data and accessor properties as an instrumented
      // accessor property
      Object.defineProperty(object, propertyName, {
        configurable: true,
        get: (function() {
          return function() {
            var origProperty;
            var callContext = getOriginatingScriptContext(!!logSettings.logCallStack);

            // get original value
            if (originalGetter) { // if accessor property
              origProperty = originalGetter.call(this);
            } else if ('value' in propDesc) { // if data property
              origProperty = originalValue;
            } else {
              console.error("Property descriptor for",
                            objectName + '.' + propertyName,
                            "doesn't have getter or value?");
              logValue(objectName + '.' + propertyName, "",
                  "get(failed)", callContext, logSettings);
              return;
            }

            // Log `gets` except those that have instrumented return values
            // * All returned functions are instrumented with a wrapper
            // * Returned objects may be instrumented if recursive
            //   instrumentation is enabled and this isn't at the depth limit.
            if (typeof origProperty == 'function') {
              return instrumentFunction(objectName, propertyName, origProperty, logSettings);
            } else if (typeof origProperty == 'object' &&
              !!logSettings.recursive &&
              (!('depth' in logSettings) || logSettings.depth > 0)) {
              return origProperty;
            } else {
              logValue(objectName + '.' + propertyName, origProperty,
                  "get", callContext, logSettings);
              return origProperty;
            }
          }
        })(),
        set: (function() {
          return function(value) {
            var callContext = getOriginatingScriptContext(!!logSettings.logCallStack);
            var returnValue;

            // Prevent sets for functions and objects if enabled
            if (!!logSettings.preventSets && (
                typeof originalValue === 'function' ||
                typeof originalValue === 'object')) {
              logValue(objectName + '.' + propertyName, value,
                  "set(prevented)", callContext, logSettings);
              return value;
            }

            // set new value to original setter/location
            if (originalSetter) { // if accessor property
              returnValue = originalSetter.call(this, value);
            } else if ('value' in propDesc) { // if data property
              originalValue = value;
              returnValue = value;
            } else {
              console.error("Property descriptor for",
                            objectName + '.' + propertyName,
                            "doesn't have setter or value?");
              logValue(objectName + '.' + propertyName, value,
                  "set(failed)", callContext, logSettings);
              return value;
            }

            // log set
            logValue(objectName + '.' + propertyName, value,
                "set", callContext, logSettings);

            // return new value
            return returnValue;
          }
        })()
      });
    }

    /*
     * Start Instrumentation
     */
    // TODO: user should be able to choose what to instrument

    // Access to navigator properties
    var navigatorProperties = [ "appCodeName", "appName", "appVersion",
                                "buildID", "cookieEnabled", "doNotTrack",
                                "geolocation", "language", "languages",
                                "onLine", "oscpu", "platform", "product",
                                "productSub", "userAgent", "vendorSub",
                                "vendor" ];
    navigatorProperties.forEach(function(property) {
      instrumentObjectProperty(window.navigator, "window.navigator", property);
    });

    // Access to screen properties
    //instrumentObject(window.screen, "window.screen");
    // TODO: why do we instrument only two screen properties
    var screenProperties =  [ "pixelDepth", "colorDepth" ];
    screenProperties.forEach(function(property) {
      instrumentObjectProperty(window.screen, "window.screen", property);
    });

    // Access to plugins
    var pluginProperties = [ "name", "filename", "description", "version", "length"];
      for (var i = 0; i < window.navigator.plugins.length; i++) {
      let pluginName = window.navigator.plugins[i].name;
      pluginProperties.forEach(function(property) {
        instrumentObjectProperty(
            window.navigator.plugins[pluginName],
            "window.navigator.plugins[" + pluginName + "]", property);
      });
    }

    // Access to MIMETypes
    var mimeTypeProperties = [ "description", "suffixes", "type"];
    for (var i = 0; i < window.navigator.mimeTypes.length; i++) {
      let mimeTypeName = window.navigator.mimeTypes[i].type;
      mimeTypeProperties.forEach(function(property) {
        instrumentObjectProperty(
            window.navigator.mimeTypes[mimeTypeName],
            "window.navigator.mimeTypes[" + mimeTypeName + "]", property);
      });
    }
    // Name, localStorage, and sessionsStorage logging
    // Instrumenting window.localStorage directly doesn't seem to work, so the Storage
    // prototype must be instrumented instead. Unfortunately this fails to differentiate
    // between sessionStorage and localStorage. Instead, you'll have to look for a sequence
    // of a get for the localStorage object followed by a getItem/setItem for the Storage object.
    var windowProperties = [ "name", "localStorage", "sessionStorage" ];
    windowProperties.forEach(function(property) {
      instrumentObjectProperty(window, "window", property);
    });
    instrumentObject(window.Storage.prototype, "window.Storage");

    // Access to document.cookie
    instrumentObjectProperty(window.document, "window.document", "cookie", {
      logCallStack: true
    });

    // Access to canvas
    instrumentObject(window.HTMLCanvasElement.prototype,"HTMLCanvasElement");

    var excludedProperties = [ "quadraticCurveTo", "lineTo", "transform",
                               "globalAlpha", "moveTo", "drawImage",
                               "setTransform", "clearRect", "closePath",
                               "beginPath", "canvas", "translate" ];
    instrumentObject(
        window.CanvasRenderingContext2D.prototype,
        "CanvasRenderingContext2D",
        {'excludedProperties': excludedProperties}
    );

    // Access to webRTC
    instrumentObject(window.RTCPeerConnection.prototype,"RTCPeerConnection");

    // Access to Audio API
    instrumentObject(window.AudioContext.prototype, "AudioContext");
    instrumentObject(window.OfflineAudioContext.prototype, "OfflineAudioContext");
    instrumentObject(window.OscillatorNode.prototype, "OscillatorNode");
    instrumentObject(window.AnalyserNode.prototype, "AnalyserNode");
    instrumentObject(window.GainNode.prototype, "GainNode");
    instrumentObject(window.ScriptProcessorNode.prototype, "ScriptProcessorNode");
    console.log("Successfully started all instrumentation.");

    /*
     * Mutation Summary Library - Start
     */

    // Copyright 2011 Google Inc.
    //
    // Licensed under the Apache License, Version 2.0 (the "License");
    // you may not use this file except in compliance with the License.
    // You may obtain a copy of the License at
    //
    //         http://www.apache.org/licenses/LICENSE-2.0
    //
    // Unless required by applicable law or agreed to in writing, software
    // distributed under the License is distributed on an "AS IS" BASIS,
    // WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    // See the License for the specific language governing permissions and
    // limitations under the License.
    var __extends = this.__extends || function (d, b) {
        for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
        function __() { this.constructor = d; }
        __.prototype = b.prototype;
        d.prototype = new __();
    };
    var MutationObserverCtor;
    if (typeof WebKitMutationObserver !== 'undefined')
        MutationObserverCtor = WebKitMutationObserver;
    else
        MutationObserverCtor = MutationObserver;
    if (MutationObserverCtor === undefined) {
        console.error('DOM Mutation Observers are required.');
        console.error('https://developer.mozilla.org/en-US/docs/DOM/MutationObserver');
        throw Error('DOM Mutation Observers are required');
    }
    var NodeMap = (function () {
        function NodeMap() {
            this.nodes = [];
            this.values = [];
        }
        NodeMap.prototype.isIndex = function (s) {
            return +s === s >>> 0;
        };
        NodeMap.prototype.nodeId = function (node) {
            var id = node[NodeMap.ID_PROP];
            if (!id)
                id = node[NodeMap.ID_PROP] = NodeMap.nextId_++;
            return id;
        };
        NodeMap.prototype.set = function (node, value) {
            var id = this.nodeId(node);
            this.nodes[id] = node;
            this.values[id] = value;
        };
        NodeMap.prototype.get = function (node) {
            var id = this.nodeId(node);
            return this.values[id];
        };
        NodeMap.prototype.has = function (node) {
            return this.nodeId(node) in this.nodes;
        };
        NodeMap.prototype.delete = function (node) {
            var id = this.nodeId(node);
            delete this.nodes[id];
            this.values[id] = undefined;
        };
        NodeMap.prototype.keys = function () {
            var nodes = [];
            for (var id in this.nodes) {
                if (!this.isIndex(id))
                    continue;
                nodes.push(this.nodes[id]);
            }
            return nodes;
        };
        NodeMap.ID_PROP = '__mutation_summary_node_map_id__';
        NodeMap.nextId_ = 1;
        return NodeMap;
    })();
    /**
     *  var reachableMatchableProduct = [
     *  //  STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED
     *    [ STAYED_OUT,  STAYED_OUT,  STAYED_OUT,  STAYED_OUT ], // STAYED_OUT
     *    [ STAYED_OUT,  ENTERED,     ENTERED,     STAYED_OUT ], // ENTERED
     *    [ STAYED_OUT,  ENTERED,     STAYED_IN,   EXITED     ], // STAYED_IN
     *    [ STAYED_OUT,  STAYED_OUT,  EXITED,      EXITED     ]  // EXITED
     *  ];
     */
    var Movement;
    (function (Movement) {
        Movement[Movement["STAYED_OUT"] = 0] = "STAYED_OUT";
        Movement[Movement["ENTERED"] = 1] = "ENTERED";
        Movement[Movement["STAYED_IN"] = 2] = "STAYED_IN";
        Movement[Movement["REPARENTED"] = 3] = "REPARENTED";
        Movement[Movement["REORDERED"] = 4] = "REORDERED";
        Movement[Movement["EXITED"] = 5] = "EXITED";
    })(Movement || (Movement = {}));
    function enteredOrExited(changeType) {
        return changeType === Movement.ENTERED || changeType === Movement.EXITED;
    }
    var NodeChange = (function () {
        function NodeChange(node, childList, attributes, characterData, oldParentNode, added, attributeOldValues, characterDataOldValue) {
            if (childList === void 0) { childList = false; }
            if (attributes === void 0) { attributes = false; }
            if (characterData === void 0) { characterData = false; }
            if (oldParentNode === void 0) { oldParentNode = null; }
            if (added === void 0) { added = false; }
            if (attributeOldValues === void 0) { attributeOldValues = null; }
            if (characterDataOldValue === void 0) { characterDataOldValue = null; }
            this.node = node;
            this.childList = childList;
            this.attributes = attributes;
            this.characterData = characterData;
            this.oldParentNode = oldParentNode;
            this.added = added;
            this.attributeOldValues = attributeOldValues;
            this.characterDataOldValue = characterDataOldValue;
            this.isCaseInsensitive =
                this.node.nodeType === Node.ELEMENT_NODE &&
                    this.node instanceof HTMLElement &&
                    this.node.ownerDocument instanceof HTMLDocument;
        }
        NodeChange.prototype.getAttributeOldValue = function (name) {
            if (!this.attributeOldValues)
                return undefined;
            if (this.isCaseInsensitive)
                name = name.toLowerCase();
            return this.attributeOldValues[name];
        };
        NodeChange.prototype.getAttributeNamesMutated = function () {
            var names = [];
            if (!this.attributeOldValues)
                return names;
            for (var name in this.attributeOldValues) {
                names.push(name);
            }
            return names;
        };
        NodeChange.prototype.attributeMutated = function (name, oldValue) {
            this.attributes = true;
            this.attributeOldValues = this.attributeOldValues || {};
            if (name in this.attributeOldValues)
                return;
            this.attributeOldValues[name] = oldValue;
        };
        NodeChange.prototype.characterDataMutated = function (oldValue) {
            if (this.characterData)
                return;
            this.characterData = true;
            this.characterDataOldValue = oldValue;
        };
        // Note: is it possible to receive a removal followed by a removal. This
        // can occur if the removed node is added to an non-observed node, that
        // node is added to the observed area, and then the node removed from
        // it.
        NodeChange.prototype.removedFromParent = function (parent) {
            this.childList = true;
            if (this.added || this.oldParentNode)
                this.added = false;
            else
                this.oldParentNode = parent;
        };
        NodeChange.prototype.insertedIntoParent = function () {
            this.childList = true;
            this.added = true;
        };
        // An node's oldParent is
        //   -its present parent, if its parentNode was not changed.
        //   -null if the first thing that happened to it was an add.
        //   -the node it was removed from if the first thing that happened to it
        //      was a remove.
        NodeChange.prototype.getOldParent = function () {
            if (this.childList) {
                if (this.oldParentNode)
                    return this.oldParentNode;
                if (this.added)
                    return null;
            }
            return this.node.parentNode;
        };
        return NodeChange;
    })();
    var ChildListChange = (function () {
        function ChildListChange() {
            this.added = new NodeMap();
            this.removed = new NodeMap();
            this.maybeMoved = new NodeMap();
            this.oldPrevious = new NodeMap();
            this.moved = undefined;
        }
        return ChildListChange;
    })();
    var TreeChanges = (function (_super) {
        __extends(TreeChanges, _super);
        function TreeChanges(rootNode, mutations) {
            _super.call(this);
            this.rootNode = rootNode;
            this.reachableCache = undefined;
            this.wasReachableCache = undefined;
            this.anyParentsChanged = false;
            this.anyAttributesChanged = false;
            this.anyCharacterDataChanged = false;
            for (var m = 0; m < mutations.length; m++) {
                var mutation = mutations[m];
                switch (mutation.type) {
                    case 'childList':
                        this.anyParentsChanged = true;
                        for (var i = 0; i < mutation.removedNodes.length; i++) {
                            var node = mutation.removedNodes[i];
                            this.getChange(node).removedFromParent(mutation.target);
                        }
                        for (var i = 0; i < mutation.addedNodes.length; i++) {
                            var node = mutation.addedNodes[i];
                            this.getChange(node).insertedIntoParent();
                        }
                        break;
                    case 'attributes':
                        this.anyAttributesChanged = true;
                        var change = this.getChange(mutation.target);
                        change.attributeMutated(mutation.attributeName, mutation.oldValue);
                        break;
                    case 'characterData':
                        this.anyCharacterDataChanged = true;
                        var change = this.getChange(mutation.target);
                        change.characterDataMutated(mutation.oldValue);
                        break;
                }
            }
        }
        TreeChanges.prototype.getChange = function (node) {
            var change = this.get(node);
            if (!change) {
                change = new NodeChange(node);
                this.set(node, change);
            }
            return change;
        };
        TreeChanges.prototype.getOldParent = function (node) {
            var change = this.get(node);
            return change ? change.getOldParent() : node.parentNode;
        };
        TreeChanges.prototype.getIsReachable = function (node) {
            if (node === this.rootNode)
                return true;
            if (!node)
                return false;
            this.reachableCache = this.reachableCache || new NodeMap();
            var isReachable = this.reachableCache.get(node);
            if (isReachable === undefined) {
                isReachable = this.getIsReachable(node.parentNode);
                this.reachableCache.set(node, isReachable);
            }
            return isReachable;
        };
        // A node wasReachable if its oldParent wasReachable.
        TreeChanges.prototype.getWasReachable = function (node) {
            if (node === this.rootNode)
                return true;
            if (!node)
                return false;
            this.wasReachableCache = this.wasReachableCache || new NodeMap();
            var wasReachable = this.wasReachableCache.get(node);
            if (wasReachable === undefined) {
                wasReachable = this.getWasReachable(this.getOldParent(node));
                this.wasReachableCache.set(node, wasReachable);
            }
            return wasReachable;
        };
        TreeChanges.prototype.reachabilityChange = function (node) {
            if (this.getIsReachable(node)) {
                return this.getWasReachable(node) ?
                    Movement.STAYED_IN : Movement.ENTERED;
            }
            return this.getWasReachable(node) ?
                Movement.EXITED : Movement.STAYED_OUT;
        };
        return TreeChanges;
    })(NodeMap);
    var MutationProjection = (function () {
        // TOOD(any)
        function MutationProjection(rootNode, mutations, selectors, calcReordered, calcOldPreviousSibling) {
            this.rootNode = rootNode;
            this.mutations = mutations;
            this.selectors = selectors;
            this.calcReordered = calcReordered;
            this.calcOldPreviousSibling = calcOldPreviousSibling;
            this.treeChanges = new TreeChanges(rootNode, mutations);
            this.entered = [];
            this.exited = [];
            this.stayedIn = new NodeMap();
            this.visited = new NodeMap();
            this.childListChangeMap = undefined;
            this.characterDataOnly = undefined;
            this.matchCache = undefined;
            this.processMutations();
        }
        MutationProjection.prototype.processMutations = function () {
            if (!this.treeChanges.anyParentsChanged &&
                !this.treeChanges.anyAttributesChanged)
                return;
            var changedNodes = this.treeChanges.keys();
            for (var i = 0; i < changedNodes.length; i++) {
                this.visitNode(changedNodes[i], undefined);
            }
        };
        MutationProjection.prototype.visitNode = function (node, parentReachable) {
            if (this.visited.has(node))
                return;
            this.visited.set(node, true);
            var change = this.treeChanges.get(node);
            var reachable = parentReachable;
            // node inherits its parent's reachability change unless
            // its parentNode was mutated.
            if ((change && change.childList) || reachable == undefined)
                reachable = this.treeChanges.reachabilityChange(node);
            if (reachable === Movement.STAYED_OUT)
                return;
            // Cache match results for sub-patterns.
            this.matchabilityChange(node);
            if (reachable === Movement.ENTERED) {
                this.entered.push(node);
            }
            else if (reachable === Movement.EXITED) {
                this.exited.push(node);
                this.ensureHasOldPreviousSiblingIfNeeded(node);
            }
            else if (reachable === Movement.STAYED_IN) {
                var movement = Movement.STAYED_IN;
                if (change && change.childList) {
                    if (change.oldParentNode !== node.parentNode) {
                        movement = Movement.REPARENTED;
                        this.ensureHasOldPreviousSiblingIfNeeded(node);
                    }
                    else if (this.calcReordered && this.wasReordered(node)) {
                        movement = Movement.REORDERED;
                    }
                }
                this.stayedIn.set(node, movement);
            }
            if (reachable === Movement.STAYED_IN)
                return;
            // reachable === ENTERED || reachable === EXITED.
            for (var child = node.firstChild; child; child = child.nextSibling) {
                this.visitNode(child, reachable);
            }
        };
        MutationProjection.prototype.ensureHasOldPreviousSiblingIfNeeded = function (node) {
            if (!this.calcOldPreviousSibling)
                return;
            this.processChildlistChanges();
            var parentNode = node.parentNode;
            var nodeChange = this.treeChanges.get(node);
            if (nodeChange && nodeChange.oldParentNode)
                parentNode = nodeChange.oldParentNode;
            var change = this.childListChangeMap.get(parentNode);
            if (!change) {
                change = new ChildListChange();
                this.childListChangeMap.set(parentNode, change);
            }
            if (!change.oldPrevious.has(node)) {
                change.oldPrevious.set(node, node.previousSibling);
            }
        };
        MutationProjection.prototype.getChanged = function (summary, selectors, characterDataOnly) {
            this.selectors = selectors;
            this.characterDataOnly = characterDataOnly;
            for (var i = 0; i < this.entered.length; i++) {
                var node = this.entered[i];
                var matchable = this.matchabilityChange(node);
                if (matchable === Movement.ENTERED || matchable === Movement.STAYED_IN)
                    summary.added.push(node);
            }
            var stayedInNodes = this.stayedIn.keys();
            for (var i = 0; i < stayedInNodes.length; i++) {
                var node = stayedInNodes[i];
                var matchable = this.matchabilityChange(node);
                if (matchable === Movement.ENTERED) {
                    summary.added.push(node);
                }
                else if (matchable === Movement.EXITED) {
                    summary.removed.push(node);
                }
                else if (matchable === Movement.STAYED_IN && (summary.reparented || summary.reordered)) {
                    var movement = this.stayedIn.get(node);
                    if (summary.reparented && movement === Movement.REPARENTED)
                        summary.reparented.push(node);
                    else if (summary.reordered && movement === Movement.REORDERED)
                        summary.reordered.push(node);
                }
            }
            for (var i = 0; i < this.exited.length; i++) {
                var node = this.exited[i];
                var matchable = this.matchabilityChange(node);
                if (matchable === Movement.EXITED || matchable === Movement.STAYED_IN)
                    summary.removed.push(node);
            }
        };
        MutationProjection.prototype.getOldParentNode = function (node) {
            var change = this.treeChanges.get(node);
            if (change && change.childList)
                return change.oldParentNode ? change.oldParentNode : null;
            var reachabilityChange = this.treeChanges.reachabilityChange(node);
            if (reachabilityChange === Movement.STAYED_OUT || reachabilityChange === Movement.ENTERED)
                throw Error('getOldParentNode requested on invalid node.');
            return node.parentNode;
        };
        MutationProjection.prototype.getOldPreviousSibling = function (node) {
            var parentNode = node.parentNode;
            var nodeChange = this.treeChanges.get(node);
            if (nodeChange && nodeChange.oldParentNode)
                parentNode = nodeChange.oldParentNode;
            var change = this.childListChangeMap.get(parentNode);
            if (!change)
                throw Error('getOldPreviousSibling requested on invalid node.');
            return change.oldPrevious.get(node);
        };
        MutationProjection.prototype.getOldAttribute = function (element, attrName) {
            var change = this.treeChanges.get(element);
            if (!change || !change.attributes)
                throw Error('getOldAttribute requested on invalid node.');
            var value = change.getAttributeOldValue(attrName);
            if (value === undefined)
                throw Error('getOldAttribute requested for unchanged attribute name.');
            return value;
        };
        MutationProjection.prototype.attributeChangedNodes = function (includeAttributes) {
            if (!this.treeChanges.anyAttributesChanged)
                return {}; // No attributes mutations occurred.
            var attributeFilter;
            var caseInsensitiveFilter;
            if (includeAttributes) {
                attributeFilter = {};
                caseInsensitiveFilter = {};
                for (var i = 0; i < includeAttributes.length; i++) {
                    var attrName = includeAttributes[i];
                    attributeFilter[attrName] = true;
                    caseInsensitiveFilter[attrName.toLowerCase()] = attrName;
                }
            }
            var result = {};
            var nodes = this.treeChanges.keys();
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                var change = this.treeChanges.get(node);
                if (!change.attributes)
                    continue;
                if (Movement.STAYED_IN !== this.treeChanges.reachabilityChange(node) ||
                    Movement.STAYED_IN !== this.matchabilityChange(node)) {
                    continue;
                }
                var element = node;
                var changedAttrNames = change.getAttributeNamesMutated();
                for (var j = 0; j < changedAttrNames.length; j++) {
                    var attrName = changedAttrNames[j];
                    if (attributeFilter &&
                        !attributeFilter[attrName] &&
                        !(change.isCaseInsensitive && caseInsensitiveFilter[attrName])) {
                        continue;
                    }
                    var oldValue = change.getAttributeOldValue(attrName);
                    if (oldValue === element.getAttribute(attrName))
                        continue;
                    if (caseInsensitiveFilter && change.isCaseInsensitive)
                        attrName = caseInsensitiveFilter[attrName];
                    result[attrName] = result[attrName] || [];
                    result[attrName].push(element);
                }
            }
            return result;
        };
        MutationProjection.prototype.getOldCharacterData = function (node) {
            var change = this.treeChanges.get(node);
            if (!change || !change.characterData)
                throw Error('getOldCharacterData requested on invalid node.');
            return change.characterDataOldValue;
        };
        MutationProjection.prototype.getCharacterDataChanged = function () {
            if (!this.treeChanges.anyCharacterDataChanged)
                return []; // No characterData mutations occurred.
            var nodes = this.treeChanges.keys();
            var result = [];
            for (var i = 0; i < nodes.length; i++) {
                var target = nodes[i];
                if (Movement.STAYED_IN !== this.treeChanges.reachabilityChange(target))
                    continue;
                var change = this.treeChanges.get(target);
                if (!change.characterData ||
                    target.textContent == change.characterDataOldValue)
                    continue;
                result.push(target);
            }
            return result;
        };
        MutationProjection.prototype.computeMatchabilityChange = function (selector, el) {
            if (!this.matchCache)
                this.matchCache = [];
            if (!this.matchCache[selector.uid])
                this.matchCache[selector.uid] = new NodeMap();
            var cache = this.matchCache[selector.uid];
            var result = cache.get(el);
            if (result === undefined) {
                result = selector.matchabilityChange(el, this.treeChanges.get(el));
                cache.set(el, result);
            }
            return result;
        };
        MutationProjection.prototype.matchabilityChange = function (node) {
            var _this = this;
            // TODO(rafaelw): Include PI, CDATA?
            // Only include text nodes.
            if (this.characterDataOnly) {
                switch (node.nodeType) {
                    case Node.COMMENT_NODE:
                    case Node.TEXT_NODE:
                        return Movement.STAYED_IN;
                    default:
                        return Movement.STAYED_OUT;
                }
            }
            // No element filter. Include all nodes.
            if (!this.selectors)
                return Movement.STAYED_IN;
            // Element filter. Exclude non-elements.
            if (node.nodeType !== Node.ELEMENT_NODE)
                return Movement.STAYED_OUT;
            var el = node;
            var matchChanges = this.selectors.map(function (selector) {
                return _this.computeMatchabilityChange(selector, el);
            });
            var accum = Movement.STAYED_OUT;
            var i = 0;
            while (accum !== Movement.STAYED_IN && i < matchChanges.length) {
                switch (matchChanges[i]) {
                    case Movement.STAYED_IN:
                        accum = Movement.STAYED_IN;
                        break;
                    case Movement.ENTERED:
                        if (accum === Movement.EXITED)
                            accum = Movement.STAYED_IN;
                        else
                            accum = Movement.ENTERED;
                        break;
                    case Movement.EXITED:
                        if (accum === Movement.ENTERED)
                            accum = Movement.STAYED_IN;
                        else
                            accum = Movement.EXITED;
                        break;
                }
                i++;
            }
            return accum;
        };
        MutationProjection.prototype.getChildlistChange = function (el) {
            var change = this.childListChangeMap.get(el);
            if (!change) {
                change = new ChildListChange();
                this.childListChangeMap.set(el, change);
            }
            return change;
        };
        MutationProjection.prototype.processChildlistChanges = function () {
            if (this.childListChangeMap)
                return;
            this.childListChangeMap = new NodeMap();
            for (var i = 0; i < this.mutations.length; i++) {
                var mutation = this.mutations[i];
                if (mutation.type != 'childList')
                    continue;
                if (this.treeChanges.reachabilityChange(mutation.target) !== Movement.STAYED_IN &&
                    !this.calcOldPreviousSibling)
                    continue;
                var change = this.getChildlistChange(mutation.target);
                var oldPrevious = mutation.previousSibling;
                function recordOldPrevious(node, previous) {
                    if (!node ||
                        change.oldPrevious.has(node) ||
                        change.added.has(node) ||
                        change.maybeMoved.has(node))
                        return;
                    if (previous &&
                        (change.added.has(previous) ||
                            change.maybeMoved.has(previous)))
                        return;
                    change.oldPrevious.set(node, previous);
                }
                for (var j = 0; j < mutation.removedNodes.length; j++) {
                    var node = mutation.removedNodes[j];
                    recordOldPrevious(node, oldPrevious);
                    if (change.added.has(node)) {
                        change.added.delete(node);
                    }
                    else {
                        change.removed.set(node, true);
                        change.maybeMoved.delete(node);
                    }
                    oldPrevious = node;
                }
                recordOldPrevious(mutation.nextSibling, oldPrevious);
                for (var j = 0; j < mutation.addedNodes.length; j++) {
                    var node = mutation.addedNodes[j];
                    if (change.removed.has(node)) {
                        change.removed.delete(node);
                        change.maybeMoved.set(node, true);
                    }
                    else {
                        change.added.set(node, true);
                    }
                }
            }
        };
        MutationProjection.prototype.wasReordered = function (node) {
            if (!this.treeChanges.anyParentsChanged)
                return false;
            this.processChildlistChanges();
            var parentNode = node.parentNode;
            var nodeChange = this.treeChanges.get(node);
            if (nodeChange && nodeChange.oldParentNode)
                parentNode = nodeChange.oldParentNode;
            var change = this.childListChangeMap.get(parentNode);
            if (!change)
                return false;
            if (change.moved)
                return change.moved.get(node);
            change.moved = new NodeMap();
            var pendingMoveDecision = new NodeMap();
            function isMoved(node) {
                if (!node)
                    return false;
                if (!change.maybeMoved.has(node))
                    return false;
                var didMove = change.moved.get(node);
                if (didMove !== undefined)
                    return didMove;
                if (pendingMoveDecision.has(node)) {
                    didMove = true;
                }
                else {
                    pendingMoveDecision.set(node, true);
                    didMove = getPrevious(node) !== getOldPrevious(node);
                }
                if (pendingMoveDecision.has(node)) {
                    pendingMoveDecision.delete(node);
                    change.moved.set(node, didMove);
                }
                else {
                    didMove = change.moved.get(node);
                }
                return didMove;
            }
            var oldPreviousCache = new NodeMap();
            function getOldPrevious(node) {
                var oldPrevious = oldPreviousCache.get(node);
                if (oldPrevious !== undefined)
                    return oldPrevious;
                oldPrevious = change.oldPrevious.get(node);
                while (oldPrevious &&
                    (change.removed.has(oldPrevious) || isMoved(oldPrevious))) {
                    oldPrevious = getOldPrevious(oldPrevious);
                }
                if (oldPrevious === undefined)
                    oldPrevious = node.previousSibling;
                oldPreviousCache.set(node, oldPrevious);
                return oldPrevious;
            }
            var previousCache = new NodeMap();
            function getPrevious(node) {
                if (previousCache.has(node))
                    return previousCache.get(node);
                var previous = node.previousSibling;
                while (previous && (change.added.has(previous) || isMoved(previous)))
                    previous = previous.previousSibling;
                previousCache.set(node, previous);
                return previous;
            }
            change.maybeMoved.keys().forEach(isMoved);
            return change.moved.get(node);
        };
        return MutationProjection;
    })();
    var Summary = (function () {
        function Summary(projection, query) {
            var _this = this;
            this.projection = projection;
            this.added = [];
            this.removed = [];
            this.reparented = query.all || query.element || query.characterData ? [] : undefined;
            this.reordered = query.all ? [] : undefined;
            projection.getChanged(this, query.elementFilter, query.characterData);
            if (query.all || query.attribute || query.attributeList) {
                var filter = query.attribute ? [query.attribute] : query.attributeList;
                var attributeChanged = projection.attributeChangedNodes(filter);
                if (query.attribute) {
                    this.valueChanged = attributeChanged[query.attribute] || [];
                }
                else {
                    this.attributeChanged = attributeChanged;
                    if (query.attributeList) {
                        query.attributeList.forEach(function (attrName) {
                            if (!_this.attributeChanged.hasOwnProperty(attrName))
                                _this.attributeChanged[attrName] = [];
                        });
                    }
                }
            }
            if (query.all || query.characterData) {
                var characterDataChanged = projection.getCharacterDataChanged();
                if (query.characterData)
                    this.valueChanged = characterDataChanged;
                else
                    this.characterDataChanged = characterDataChanged;
            }
            if (this.reordered)
                this.getOldPreviousSibling = projection.getOldPreviousSibling.bind(projection);
        }
        Summary.prototype.getOldParentNode = function (node) {
            return this.projection.getOldParentNode(node);
        };
        Summary.prototype.getOldAttribute = function (node, name) {
            return this.projection.getOldAttribute(node, name);
        };
        Summary.prototype.getOldCharacterData = function (node) {
            return this.projection.getOldCharacterData(node);
        };
        Summary.prototype.getOldPreviousSibling = function (node) {
            return this.projection.getOldPreviousSibling(node);
        };
        return Summary;
    })();
    // TODO(rafaelw): Allow ':' and '.' as valid name characters.
    var validNameInitialChar = /[a-zA-Z_]+/;
    var validNameNonInitialChar = /[a-zA-Z0-9_\-]+/;
    // TODO(rafaelw): Consider allowing backslash in the attrValue.
    // TODO(rafaelw): There's got a to be way to represent this state machine
    // more compactly???
    function escapeQuotes(value) {
        return '"' + value.replace(/"/, '\\\"') + '"';
    }
    var Qualifier = (function () {
        function Qualifier() {
        }
        Qualifier.prototype.matches = function (oldValue) {
            if (oldValue === null)
                return false;
            if (this.attrValue === undefined)
                return true;
            if (!this.contains)
                return this.attrValue == oldValue;
            var tokens = oldValue.split(' ');
            for (var i = 0; i < tokens.length; i++) {
                if (this.attrValue === tokens[i])
                    return true;
            }
            return false;
        };
        Qualifier.prototype.toString = function () {
            if (this.attrName === 'class' && this.contains)
                return '.' + this.attrValue;
            if (this.attrName === 'id' && !this.contains)
                return '#' + this.attrValue;
            if (this.contains)
                return '[' + this.attrName + '~=' + escapeQuotes(this.attrValue) + ']';
            if ('attrValue' in this)
                return '[' + this.attrName + '=' + escapeQuotes(this.attrValue) + ']';
            return '[' + this.attrName + ']';
        };
        return Qualifier;
    })();
    var Selector = (function () {
        function Selector() {
            this.uid = Selector.nextUid++;
            this.qualifiers = [];
        }
        Object.defineProperty(Selector.prototype, "caseInsensitiveTagName", {
            get: function () {
                return this.tagName.toUpperCase();
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(Selector.prototype, "selectorString", {
            get: function () {
                return this.tagName + this.qualifiers.join('');
            },
            enumerable: true,
            configurable: true
        });
        Selector.prototype.isMatching = function (el) {
            return el[Selector.matchesSelector](this.selectorString);
        };
        Selector.prototype.wasMatching = function (el, change, isMatching) {
            if (!change || !change.attributes)
                return isMatching;
            var tagName = change.isCaseInsensitive ? this.caseInsensitiveTagName : this.tagName;
            if (tagName !== '*' && tagName !== el.tagName)
                return false;
            var attributeOldValues = [];
            var anyChanged = false;
            for (var i = 0; i < this.qualifiers.length; i++) {
                var qualifier = this.qualifiers[i];
                var oldValue = change.getAttributeOldValue(qualifier.attrName);
                attributeOldValues.push(oldValue);
                anyChanged = anyChanged || (oldValue !== undefined);
            }
            if (!anyChanged)
                return isMatching;
            for (var i = 0; i < this.qualifiers.length; i++) {
                var qualifier = this.qualifiers[i];
                var oldValue = attributeOldValues[i];
                if (oldValue === undefined)
                    oldValue = el.getAttribute(qualifier.attrName);
                if (!qualifier.matches(oldValue))
                    return false;
            }
            return true;
        };
        Selector.prototype.matchabilityChange = function (el, change) {
            var isMatching = this.isMatching(el);
            if (isMatching)
                return this.wasMatching(el, change, isMatching) ? Movement.STAYED_IN : Movement.ENTERED;
            else
                return this.wasMatching(el, change, isMatching) ? Movement.EXITED : Movement.STAYED_OUT;
        };
        Selector.parseSelectors = function (input) {
            var selectors = [];
            var currentSelector;
            var currentQualifier;
            function newSelector() {
                if (currentSelector) {
                    if (currentQualifier) {
                        currentSelector.qualifiers.push(currentQualifier);
                        currentQualifier = undefined;
                    }
                    selectors.push(currentSelector);
                }
                currentSelector = new Selector();
            }
            function newQualifier() {
                if (currentQualifier)
                    currentSelector.qualifiers.push(currentQualifier);
                currentQualifier = new Qualifier();
            }
            var WHITESPACE = /\s/;
            var valueQuoteChar;
            var SYNTAX_ERROR = 'Invalid or unsupported selector syntax.';
            var SELECTOR = 1;
            var TAG_NAME = 2;
            var QUALIFIER = 3;
            var QUALIFIER_NAME_FIRST_CHAR = 4;
            var QUALIFIER_NAME = 5;
            var ATTR_NAME_FIRST_CHAR = 6;
            var ATTR_NAME = 7;
            var EQUIV_OR_ATTR_QUAL_END = 8;
            var EQUAL = 9;
            var ATTR_QUAL_END = 10;
            var VALUE_FIRST_CHAR = 11;
            var VALUE = 12;
            var QUOTED_VALUE = 13;
            var SELECTOR_SEPARATOR = 14;
            var state = SELECTOR;
            var i = 0;
            while (i < input.length) {
                var c = input[i++];
                switch (state) {
                    case SELECTOR:
                        if (c.match(validNameInitialChar)) {
                            newSelector();
                            currentSelector.tagName = c;
                            state = TAG_NAME;
                            break;
                        }
                        if (c == '*') {
                            newSelector();
                            currentSelector.tagName = '*';
                            state = QUALIFIER;
                            break;
                        }
                        if (c == '.') {
                            newSelector();
                            newQualifier();
                            currentSelector.tagName = '*';
                            currentQualifier.attrName = 'class';
                            currentQualifier.contains = true;
                            state = QUALIFIER_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c == '#') {
                            newSelector();
                            newQualifier();
                            currentSelector.tagName = '*';
                            currentQualifier.attrName = 'id';
                            state = QUALIFIER_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c == '[') {
                            newSelector();
                            newQualifier();
                            currentSelector.tagName = '*';
                            currentQualifier.attrName = '';
                            state = ATTR_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c.match(WHITESPACE))
                            break;
                        throw Error(SYNTAX_ERROR);
                    case TAG_NAME:
                        if (c.match(validNameNonInitialChar)) {
                            currentSelector.tagName += c;
                            break;
                        }
                        if (c == '.') {
                            newQualifier();
                            currentQualifier.attrName = 'class';
                            currentQualifier.contains = true;
                            state = QUALIFIER_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c == '#') {
                            newQualifier();
                            currentQualifier.attrName = 'id';
                            state = QUALIFIER_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c == '[') {
                            newQualifier();
                            currentQualifier.attrName = '';
                            state = ATTR_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c.match(WHITESPACE)) {
                            state = SELECTOR_SEPARATOR;
                            break;
                        }
                        if (c == ',') {
                            state = SELECTOR;
                            break;
                        }
                        throw Error(SYNTAX_ERROR);
                    case QUALIFIER:
                        if (c == '.') {
                            newQualifier();
                            currentQualifier.attrName = 'class';
                            currentQualifier.contains = true;
                            state = QUALIFIER_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c == '#') {
                            newQualifier();
                            currentQualifier.attrName = 'id';
                            state = QUALIFIER_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c == '[') {
                            newQualifier();
                            currentQualifier.attrName = '';
                            state = ATTR_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c.match(WHITESPACE)) {
                            state = SELECTOR_SEPARATOR;
                            break;
                        }
                        if (c == ',') {
                            state = SELECTOR;
                            break;
                        }
                        throw Error(SYNTAX_ERROR);
                    case QUALIFIER_NAME_FIRST_CHAR:
                        if (c.match(validNameInitialChar)) {
                            currentQualifier.attrValue = c;
                            state = QUALIFIER_NAME;
                            break;
                        }
                        throw Error(SYNTAX_ERROR);
                    case QUALIFIER_NAME:
                        if (c.match(validNameNonInitialChar)) {
                            currentQualifier.attrValue += c;
                            break;
                        }
                        if (c == '.') {
                            newQualifier();
                            currentQualifier.attrName = 'class';
                            currentQualifier.contains = true;
                            state = QUALIFIER_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c == '#') {
                            newQualifier();
                            currentQualifier.attrName = 'id';
                            state = QUALIFIER_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c == '[') {
                            newQualifier();
                            state = ATTR_NAME_FIRST_CHAR;
                            break;
                        }
                        if (c.match(WHITESPACE)) {
                            state = SELECTOR_SEPARATOR;
                            break;
                        }
                        if (c == ',') {
                            state = SELECTOR;
                            break;
                        }
                        throw Error(SYNTAX_ERROR);
                    case ATTR_NAME_FIRST_CHAR:
                        if (c.match(validNameInitialChar)) {
                            currentQualifier.attrName = c;
                            state = ATTR_NAME;
                            break;
                        }
                        if (c.match(WHITESPACE))
                            break;
                        throw Error(SYNTAX_ERROR);
                    case ATTR_NAME:
                        if (c.match(validNameNonInitialChar)) {
                            currentQualifier.attrName += c;
                            break;
                        }
                        if (c.match(WHITESPACE)) {
                            state = EQUIV_OR_ATTR_QUAL_END;
                            break;
                        }
                        if (c == '~') {
                            currentQualifier.contains = true;
                            state = EQUAL;
                            break;
                        }
                        if (c == '=') {
                            currentQualifier.attrValue = '';
                            state = VALUE_FIRST_CHAR;
                            break;
                        }
                        if (c == ']') {
                            state = QUALIFIER;
                            break;
                        }
                        throw Error(SYNTAX_ERROR);
                    case EQUIV_OR_ATTR_QUAL_END:
                        if (c == '~') {
                            currentQualifier.contains = true;
                            state = EQUAL;
                            break;
                        }
                        if (c == '=') {
                            currentQualifier.attrValue = '';
                            state = VALUE_FIRST_CHAR;
                            break;
                        }
                        if (c == ']') {
                            state = QUALIFIER;
                            break;
                        }
                        if (c.match(WHITESPACE))
                            break;
                        throw Error(SYNTAX_ERROR);
                    case EQUAL:
                        if (c == '=') {
                            currentQualifier.attrValue = '';
                            state = VALUE_FIRST_CHAR;
                            break;
                        }
                        throw Error(SYNTAX_ERROR);
                    case ATTR_QUAL_END:
                        if (c == ']') {
                            state = QUALIFIER;
                            break;
                        }
                        if (c.match(WHITESPACE))
                            break;
                        throw Error(SYNTAX_ERROR);
                    case VALUE_FIRST_CHAR:
                        if (c.match(WHITESPACE))
                            break;
                        if (c == '"' || c == "'") {
                            valueQuoteChar = c;
                            state = QUOTED_VALUE;
                            break;
                        }
                        currentQualifier.attrValue += c;
                        state = VALUE;
                        break;
                    case VALUE:
                        if (c.match(WHITESPACE)) {
                            state = ATTR_QUAL_END;
                            break;
                        }
                        if (c == ']') {
                            state = QUALIFIER;
                            break;
                        }
                        if (c == "'" || c == '"')
                            throw Error(SYNTAX_ERROR);
                        currentQualifier.attrValue += c;
                        break;
                    case QUOTED_VALUE:
                        if (c == valueQuoteChar) {
                            state = ATTR_QUAL_END;
                            break;
                        }
                        currentQualifier.attrValue += c;
                        break;
                    case SELECTOR_SEPARATOR:
                        if (c.match(WHITESPACE))
                            break;
                        if (c == ',') {
                            state = SELECTOR;
                            break;
                        }
                        throw Error(SYNTAX_ERROR);
                }
            }
            switch (state) {
                case SELECTOR:
                case TAG_NAME:
                case QUALIFIER:
                case QUALIFIER_NAME:
                case SELECTOR_SEPARATOR:
                    // Valid end states.
                    newSelector();
                    break;
                default:
                    throw Error(SYNTAX_ERROR);
            }
            if (!selectors.length)
                throw Error(SYNTAX_ERROR);
            return selectors;
        };
        Selector.nextUid = 1;
        Selector.matchesSelector = (function () {
            var element = document.createElement('div');
            if (typeof element['webkitMatchesSelector'] === 'function')
                return 'webkitMatchesSelector';
            if (typeof element['mozMatchesSelector'] === 'function')
                return 'mozMatchesSelector';
            if (typeof element['msMatchesSelector'] === 'function')
                return 'msMatchesSelector';
            return 'matchesSelector';
        })();
        return Selector;
    })();
    var attributeFilterPattern = /^([a-zA-Z:_]+[a-zA-Z0-9_\-:\.]*)$/;
    function validateAttribute(attribute) {
        if (typeof attribute != 'string')
            throw Error('Invalid request opion. attribute must be a non-zero length string.');
        attribute = attribute.trim();
        if (!attribute)
            throw Error('Invalid request opion. attribute must be a non-zero length string.');
        if (!attribute.match(attributeFilterPattern))
            throw Error('Invalid request option. invalid attribute name: ' + attribute);
        return attribute;
    }
    function validateElementAttributes(attribs) {
        if (!attribs.trim().length)
            throw Error('Invalid request option: elementAttributes must contain at least one attribute.');
        var lowerAttributes = {};
        var attributes = {};
        var tokens = attribs.split(/\s+/);
        for (var i = 0; i < tokens.length; i++) {
            var name = tokens[i];
            if (!name)
                continue;
            var name = validateAttribute(name);
            var nameLower = name.toLowerCase();
            if (lowerAttributes[nameLower])
                throw Error('Invalid request option: observing multiple case variations of the same attribute is not supported.');
            attributes[name] = true;
            lowerAttributes[nameLower] = true;
        }
        return Object.keys(attributes);
    }
    function elementFilterAttributes(selectors) {
        var attributes = {};
        selectors.forEach(function (selector) {
            selector.qualifiers.forEach(function (qualifier) {
                attributes[qualifier.attrName] = true;
            });
        });
        return Object.keys(attributes);
    }
    var MutationSummary = (function () {
        function MutationSummary(opts) {
            var _this = this;
            this.connected = false;
            this.options = MutationSummary.validateOptions(opts);
            this.observerOptions = MutationSummary.createObserverOptions(this.options.queries);
            this.root = this.options.rootNode;
            this.callback = this.options.callback;
            this.elementFilter = Array.prototype.concat.apply([], this.options.queries.map(function (query) {
                return query.elementFilter ? query.elementFilter : [];
            }));
            if (!this.elementFilter.length)
                this.elementFilter = undefined;
            this.calcReordered = this.options.queries.some(function (query) {
                return query.all;
            });
            this.queryValidators = []; // TODO(rafaelw): Shouldn't always define this.
            if (MutationSummary.createQueryValidator) {
                this.queryValidators = this.options.queries.map(function (query) {
                    return MutationSummary.createQueryValidator(_this.root, query);
                });
            }
            this.observer = new MutationObserverCtor(function (mutations) {
                _this.observerCallback(mutations);
            });
            this.reconnect();
        }
        MutationSummary.createObserverOptions = function (queries) {
            var observerOptions = {
                childList: true,
                subtree: true
            };
            var attributeFilter;
            function observeAttributes(attributes) {
                if (observerOptions.attributes && !attributeFilter)
                    return; // already observing all.
                observerOptions.attributes = true;
                observerOptions.attributeOldValue = true;
                if (!attributes) {
                    // observe all.
                    attributeFilter = undefined;
                    return;
                }
                // add to observed.
                attributeFilter = attributeFilter || {};
                attributes.forEach(function (attribute) {
                    attributeFilter[attribute] = true;
                    attributeFilter[attribute.toLowerCase()] = true;
                });
            }
            queries.forEach(function (query) {
                if (query.characterData) {
                    observerOptions.characterData = true;
                    observerOptions.characterDataOldValue = true;
                    return;
                }
                if (query.all) {
                    observeAttributes();
                    observerOptions.characterData = true;
                    observerOptions.characterDataOldValue = true;
                    return;
                }
                if (query.attribute) {
                    observeAttributes([query.attribute.trim()]);
                    return;
                }
                var attributes = elementFilterAttributes(query.elementFilter).concat(query.attributeList || []);
                if (attributes.length)
                    observeAttributes(attributes);
            });
            if (attributeFilter)
                observerOptions.attributeFilter = Object.keys(attributeFilter);
            return observerOptions;
        };
        MutationSummary.validateOptions = function (options) {
            for (var prop in options) {
                if (!(prop in MutationSummary.optionKeys))
                    throw Error('Invalid option: ' + prop);
            }
            if (typeof options.callback !== 'function')
                throw Error('Invalid options: callback is required and must be a function');
            if (!options.queries || !options.queries.length)
                throw Error('Invalid options: queries must contain at least one query request object.');
            var opts = {
                callback: options.callback,
                rootNode: options.rootNode || document,
                observeOwnChanges: !!options.observeOwnChanges,
                oldPreviousSibling: !!options.oldPreviousSibling,
                queries: []
            };
            for (var i = 0; i < options.queries.length; i++) {
                var request = options.queries[i];
                // all
                if (request.all) {
                    if (Object.keys(request).length > 1)
                        throw Error('Invalid request option. all has no options.');
                    opts.queries.push({ all: true });
                    continue;
                }
                // attribute
                if ('attribute' in request) {
                    var query = {
                        attribute: validateAttribute(request.attribute)
                    };
                    query.elementFilter = Selector.parseSelectors('*[' + query.attribute + ']');
                    if (Object.keys(request).length > 1)
                        throw Error('Invalid request option. attribute has no options.');
                    opts.queries.push(query);
                    continue;
                }
                // element
                if ('element' in request) {
                    var requestOptionCount = Object.keys(request).length;
                    var query = {
                        element: request.element,
                        elementFilter: Selector.parseSelectors(request.element)
                    };
                    if (request.hasOwnProperty('elementAttributes')) {
                        query.attributeList = validateElementAttributes(request.elementAttributes);
                        requestOptionCount--;
                    }
                    if (requestOptionCount > 1)
                        throw Error('Invalid request option. element only allows elementAttributes option.');
                    opts.queries.push(query);
                    continue;
                }
                // characterData
                if (request.characterData) {
                    if (Object.keys(request).length > 1)
                        throw Error('Invalid request option. characterData has no options.');
                    opts.queries.push({ characterData: true });
                    continue;
                }
                throw Error('Invalid request option. Unknown query request.');
            }
            return opts;
        };
        MutationSummary.prototype.createSummaries = function (mutations) {
            if (!mutations || !mutations.length)
                return [];
            var projection = new MutationProjection(this.root, mutations, this.elementFilter, this.calcReordered, this.options.oldPreviousSibling);
            var summaries = [];
            for (var i = 0; i < this.options.queries.length; i++) {
                summaries.push(new Summary(projection, this.options.queries[i]));
            }
            return summaries;
        };
        MutationSummary.prototype.checkpointQueryValidators = function () {
            this.queryValidators.forEach(function (validator) {
                if (validator)
                    validator.recordPreviousState();
            });
        };
        MutationSummary.prototype.runQueryValidators = function (summaries) {
            this.queryValidators.forEach(function (validator, index) {
                if (validator)
                    validator.validate(summaries[index]);
            });
        };
        MutationSummary.prototype.changesToReport = function (summaries) {
            return summaries.some(function (summary) {
                var summaryProps = ['added', 'removed', 'reordered', 'reparented',
                    'valueChanged', 'characterDataChanged'];
                if (summaryProps.some(function (prop) { return summary[prop] && summary[prop].length; }))
                    return true;
                if (summary.attributeChanged) {
                    var attrNames = Object.keys(summary.attributeChanged);
                    var attrsChanged = attrNames.some(function (attrName) {
                        return !!summary.attributeChanged[attrName].length;
                    });
                    if (attrsChanged)
                        return true;
                }
                return false;
            });
        };
        MutationSummary.prototype.observerCallback = function (mutations) {
            if (!this.options.observeOwnChanges)
                this.observer.disconnect();
            var summaries = this.createSummaries(mutations);
            this.runQueryValidators(summaries);
            if (this.options.observeOwnChanges)
                this.checkpointQueryValidators();
            if (this.changesToReport(summaries))
                this.callback(summaries);
            // disconnect() may have been called during the callback.
            if (!this.options.observeOwnChanges && this.connected) {
                this.checkpointQueryValidators();
                this.observer.observe(this.root, this.observerOptions);
            }
        };
        MutationSummary.prototype.reconnect = function () {
            if (this.connected)
                throw Error('Already connected');
            this.observer.observe(this.root, this.observerOptions);
            this.connected = true;
            this.checkpointQueryValidators();
        };
        MutationSummary.prototype.takeSummaries = function () {
            if (!this.connected)
                throw Error('Not connected');
            var summaries = this.createSummaries(this.observer.takeRecords());
            return this.changesToReport(summaries) ? summaries : undefined;
        };
        MutationSummary.prototype.disconnect = function () {
            var summaries = this.takeSummaries();
            this.observer.disconnect();
            this.connected = false;
            return summaries;
        };
        MutationSummary.NodeMap = NodeMap; // exposed for use in TreeMirror.
        MutationSummary.parseElementFilter = Selector.parseSelectors; // exposed for testing.
        MutationSummary.optionKeys = {
            'callback': true,
            'queries': true,
            'rootNode': true,
            'oldPreviousSibling': true,
            'observeOwnChanges': true
        };
        return MutationSummary;
    })();
    /*
     * Mutation Summary Library - End
     */

    /* Mutation Summary - Begin */
    var observerSummary;

    function getNodeBoundingClientRect(node) {
      // node can be an element or a TextNode
      if (node.getBoundingClientRect)
        return node.getBoundingClientRect();

      // create a Range to find the bounding rect for textNodes
      // modifed from https://stackoverflow.com/a/6966613
      var range = document.createRange();
      range.selectNodeContents(node);
      if (range.getBoundingClientRect) {
        return range.getBoundingClientRect();
      }
      return null;
    }

    // Modified from https://stackoverflow.com/a/12418814
    function inViewport (node) {
      var r, html;
      //
      if (!(node || 1 === node.nodeType || 3 === node.nodeType))
        return false;
      html = document.documentElement;
      r = getNodeBoundingClientRect(node);
      return (
        !!r && r.bottom >= 0 && r.right >= 0 &&
        r.top <= html.clientHeight &&
        r.left <= html.clientWidth
      );
    }


    // TODO: populate the node
    const FILTERED_NODETYPES = ["SCRIPT", "STYLE", "DOCUMENT"]
    const TEXTNODE_NODETYPE = 3
    const ELEMENT_NODETYPE = 1

    function isVisible (node, logType) {
      if (logType == "NodeRemoved"){
        // not visible if removed
        return false;
      }else{
        try{
          return inViewport(node);
        }catch(err){
          console.log("Error when determining visibility", err)
          return "?";
        }
      }
    }

    function shouldExclude(logType, node, isTextNode, summary){
      let tagNameToCheck = node.tagName;
      if (node.nodeType !== ELEMENT_NODETYPE && !isTextNode){
        console.log("Excluding element of type", node.tagName,
          node.nodeName, node.nodeType);
        return true;
      }

      if (isTextNode){
        // get parent's tagName for text nodes
        tagNameToCheck = logType == "NodeRemoved" ?
          summary.getOldParentNode(node).tagName:
          node.parentNode.tagName;
      }

      if (FILTERED_NODETYPES.includes(tagNameToCheck)){
        console.log("Excluding element of type",
          node.tagName, node.nodeName, node.nodeType, tagNameToCheck)
        return true;
      }
      return false;
    }

    function logMutationSummary(logType, node, summary, attrName=""){
      let isTextNode = node.nodeType == TEXTNODE_NODETYPE;
      if (shouldExclude(logType, node, isTextNode, summary))
        return;

      let visible = isVisible(node, logType);

      let oldValue = "" // old char data or attribute value
      if (logType == "CharacterDataChanged"){
        oldValue = summary.getOldCharacterData(node)
      }else if (logType == "AttributeChanged"){
        oldValue = summary.getOldAttribute(node, attrName);
      }
      let style = isTextNode ? "" : window.getComputedStyle(node);
      console.log(logType, ", NodeName:", node.nodeName,
                  ", TextContent:", node.textContent && node.textContent.trim(),
                  ", WholeText:", node.wholeText && node.wholeText.trim(),
                  ", NodeId:", node.__mutation_summary_node_map_id__,
                  ", Visible:", visible,
                  ", Style:", style,
                  oldValue? ", Old Value: " + oldValue :"");
    }

    function onNodeAdded(node, summary){
      logMutationSummary("NodeAdded", node, summary);
    }

    function onNodeRemoved(node, summary){
      logMutationSummary("NodeRemoved", node, summary);
    }

    function onNodeReparented(node, summary){
      logMutationSummary("NodeReparented", node, summary);
    }

    function onNodeReordered(node, summary){
      logMutationSummary("NodeReordered", node, summary);
    }

    function onCharacterDataChanged(node, summary){
      logMutationSummary("CharacterDataChanged", node, summary);
    }

    function onAttrsChanged(attrChanges, summary){
      for (var attrName in attrChanges){
        var nodes = attrChanges[attrName];
        for (var node of nodes){
          logMutationSummary("AttributeChanged", node, summary, attrName);
        }
      }
    }

    function handleSummary(summaries) {
      // MutationSummary returns one summary for each query - we've one query
      var summary = summaries[0];
      summary.added.forEach(function(node){
        onNodeAdded(node, summary)
      });
      summary.removed.forEach(function(node){
        onNodeRemoved(node, summary)
      });
      summary.reparented.forEach(function(node){
        onNodeReparented(node, summary)
      });
      summary.reordered.forEach(function(node){
        onNodeReordered(node, summary)
      });
      summary.characterDataChanged.forEach(function(node){
        onCharacterDataChanged(node, summary)
      });
      onAttrsChanged(summary.attributeChanged, summary);
    }

    window.onload = function(){
      observerSummary = new MutationSummary({
        callback: handleSummary, queries: [{all: true}]});
    }

    /* Mutation Summary - End */


  } + "());";
}


function insertScript(text, data) {
  var parent = document.documentElement,
    script = document.createElement('script');
  script.text = text;
  script.async = false;

  for (var key in data) {
    script.setAttribute('data-' + key.replace('_', '-'), data[key]);
  }

  parent.insertBefore(script, parent.firstChild);
  parent.removeChild(script);
}

function emitMsg(type, msg) {
  msg.timeStamp = new Date().toISOString();
  self.port.emit(type, msg);
}

var event_id = Math.random();

// listen for messages from the script we are about to insert
document.addEventListener(event_id, function (e) {
  // pass these on to the background page
  var msgs = e.detail;
  if (Array.isArray(msgs)) {
    msgs.forEach(function (msg) {
      emitMsg(msg['type'],msg['content']);
    });
  } else {
    emitMsg(msgs['type'],msgs['content']);
  }
});

insertScript(getPageScript(), {
  event_id: event_id,
  testing: self.options.testing
});
