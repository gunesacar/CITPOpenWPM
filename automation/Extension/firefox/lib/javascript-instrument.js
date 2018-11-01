var pageMod = require("sdk/page-mod");
const data = require("sdk/self").data;
var loggingDB = require("./loggingdb.js");

exports.run = function(crawlID, testing) {

  // Inject content script to instrument JavaScript API
  pageMod.PageMod({
    include: "*",
    contentScriptWhen: "start",
    contentScriptFile: data.url("./content.js"),
    contentScriptOptions: {
      'testing': testing
    },
    onAttach: function onAttach(worker) {

      function processMutationSummaries(data) {
        var update = {};
        update["crawl_id"] = crawlID;
        update["log_type"] = loggingDB.escapeString(data.logType);
        update["node_name"] = loggingDB.escapeString(data.nodeName);
        update["node_id"] = loggingDB.escapeString(data.nodeId);
        update["visible"] = loggingDB.escapeString(data.visible);
        update["top"] = loggingDB.escapeString(data.top);
        update["left"] = loggingDB.escapeString(data.left);
        update["width"] = loggingDB.escapeString(data.width);
        update["height"] = loggingDB.escapeString(data.height);
        update["text_content"] = loggingDB.escapeString(data.textContent);
        update["whole_text"] = loggingDB.escapeString(data.wholeText);
        update["style"] = loggingDB.escapeString(data.style);
        update["old_value"] = loggingDB.escapeString(data.oldValue);
        update["time_stamp"] = data.mutationTimeStamp;
        loggingDB.saveRecord("mutations", update);
      }

      function processCallsAndValues(data) {
        var update = {};
        update["crawl_id"] = crawlID;
        update["script_url"] = loggingDB.escapeString(data.scriptUrl);
        update["script_line"] = loggingDB.escapeString(data.scriptLine);
        update["script_col"] = loggingDB.escapeString(data.scriptCol);
        update["func_name"] = loggingDB.escapeString(data.funcName);
        update["script_loc_eval"] = loggingDB.escapeString(data.scriptLocEval);
        update["call_stack"] = loggingDB.escapeString(data.callStack);
        update["symbol"] = loggingDB.escapeString(data.symbol);
        update["operation"] = loggingDB.escapeString(data.operation);
        update["value"] = loggingDB.escapeString(data.value);
        update["time_stamp"] = data.timeStamp;

        // document_url is the current frame's document href
        // top_level_url is the top-level frame's document href
        update["document_url"] = loggingDB.escapeString(worker.url);
        update["top_level_url"] = loggingDB.escapeString(worker.tab.url);

        // Create a json object for function arguments
        // We create an object that maps array positon to argument
        // e.g. someFunc('a',123,'b') --> {0: a, 1: 123, 2: 'b'}
        // to make it easier to query the data, using something like the
        // sqlite3 json1 extension.
        var args = {};
        if (data.operation == 'call' && data.args.length > 0) {
          for(var i = 0; i < data.args.length; i++) {
            args[i] = data.args[i]
          }
          update["arguments"] = loggingDB.escapeString(JSON.stringify(args));
        }

        loggingDB.saveRecord("javascript", update);
      }
      worker.port.on("logCall", function(data){processCallsAndValues(data)});
      worker.port.on("logValue", function(data){processCallsAndValues(data)});
      worker.port.on("logMutation", function(data){processMutationSummaries(data)});
    }
  });
};
