"use strict";
var os = require("os");
var fs = require("fs");
var async = require("async");
var Validator = require('jsonschema').Validator;
var yamljs = require("yamljs");

var schema = require("./schema");
var swaggerUtils = require("./swagger");

/**
 * module to regenerate the folders/files from swagger.yaml file
 * @type {{generate: swaggerModule.generate}}
 */
var swaggerModule = {
	"generate": function (directoryToUse, configPath, yamlPath, callback) {
		var yamlContent = fs.readFileSync(yamlPath, "utf8");
		var config = require(configPath);
		delete config.schema;
		delete config.errors;
		
		//global object in this function to hold data that is juggled between functions
		var context = {
			yaml: null,
			soajs: {
				config: config
			}
		};

		/**
		 * parse the yaml and generate a config.js content from it
		 * @param cb
		 * @returns {*}
		 */
		function validateYaml(cb) {
			var jsonAPISchema;

			try {
				jsonAPISchema = yamljs.parse(yamlContent);
			}
			catch (e) {
				return callback({"code": 851, "msg": e.message});
			}

			try {
				swaggerUtils.validateYaml(jsonAPISchema);
			}
			catch (e) {
				return callback({"code": 173, "msg": e.message});
			}

			context.yaml = jsonAPISchema;
			
			swaggerUtils.mapAPis(jsonAPISchema, function (response) {
				context.soajs.config.schema = response.schema;
				context.soajs.config.errors = response.errors;

				var myValidator = new Validator();
				var check = myValidator.validate(context.soajs.config, schema);
				if (check.valid) {
					return cb(null, true);
				}
				else {
					var errMsgs = [];
					check.errors.forEach(function (oneError) {
						errMsgs.push(oneError.stack);
					});
					return callback({"code": 172,"msg": new Error(errMsgs.join(" - ")).message});
				}
			});
		}

		/**
		 * generate the folders and files needed to create a new microservice
		 * @param cb
		 */
		function generateModule(cb) {

			/**
			 * create and fill all the files needed for the microservice
			 * @param mCb
			 */
			function writeFiles(mCb) {
				var files = [
					{
						file: directoryToUse + "config.js",
						data: "\"use strict\";" + os.EOL + "module.exports = " + JSON.stringify(context.soajs.config, null, 2) + ";",
						tokens: {
							dirname: "__dirname"
						},
						purify: true
					}
				];

				//loop on all files and write them
				async.each(files, function (fileObj, mCb) {
					var data = swaggerUtils.cloneObj(fileObj.data);

					//if tokens, replace all occurences with corresponding values
					if (fileObj.tokens) {
						for (var i in fileObj.tokens) {
							var regexp = new RegExp("%" + i + "%", "g");
							data = data.replace(regexp, fileObj.tokens[i]);
						}
					}
					if (fileObj.purify) {
						data = data.replace(/\\"/g, '"').replace(/["]+/g, '"').replace(/"__dirname/g, '__dirname');
						//"__dirname + \"/lib/mw/_get.js\""
						//"__dirname + "/lib/mw/_get.js""
						//"__dirname + "/lib/mw/_get.js"
						//__dirname + "/lib/mw/_get.js"
					}
					console.log("creating file:", fileObj.file);
					fs.writeFile(fileObj.file, data, "utf8", mCb);
				}, function (error) {
					if(error){
						return callback({"code": 854, "msg": error.message });
					}
					return mCb(null, true);
				});
			}

			/**
			 * Generate the middleware for each API in the config.schema
			 */
			function generateAPIsMw(cb) {
				var APIs = [];
				for (var method in context.soajs.config.schema) {
					if (method !== 'commonFields') {
						for (var apiRoute in context.soajs.config.schema[method]) {
							var apiName = apiRoute.replace(/\\/g, "_").replace(/:/g, "_").replace(/\//g, "_").replace(/[_]{2,}/g, "_");
							apiName = apiName.toLowerCase();
							if (apiName[0] === "_") {
								apiName = apiName.substring(1);
							}
							APIs.push({original: apiRoute, copy: apiName + "_" + method.toLowerCase() + ".js"});
						}
					}
				}
				async.each(APIs, function (oneAPI, mCb) {
					fs.exists(directoryToUse + "/lib/mw/" + oneAPI.copy, function(exists){
						if(exists){
							return mCb(null, true);
						}
						
						var data = fs.readFileSync(__dirname + "/mw.txt", "utf8");
						var regexp = new RegExp("%api%", "g");
						data = data.replace(regexp, oneAPI.original);
						fs.writeFile(directoryToUse + "/lib/mw/" + oneAPI.copy, data, "utf8", mCb);
					});
				}, function (error) {
					if(error){
						return callback({"code": 854, "msg": error.message });
					}
					return cb(null, true);
				});
			}

			//run the BL of this function
			writeFiles(function () {
				generateAPIsMw(cb);
			});
		}

		//run the BL of this API
		validateYaml(function () {
			generateModule(function () {
				return callback(null, "micro service files have been regenerated.");
			});
		});
	}
};

module.exports = swaggerModule;