"use strict"
const fs = require('fs');
const clapPathPrefix = __dirname + "/../modules/clap/include/clap";

let constants = {
	CLAP_NAME_SIZE: 256,
	CLAP_PATH_SIZE: 1024,
	CLAP_REMOTE_CONTROLS_COUNT: 8
};
let aliases = {
	'char': 'int8'
};
function normaliseTypeName(name) {
	name = ` ${name.replace(/\s+/g, ' ')} `;
	name = name.replace(/\*/g, ' * '); // space around constant
	name = name.replace(/\s+struct\s+/g, ' '); // remove struct
	name = name.replace(/_t\s/g, ''); // remove _t suffix
	name = ` ${name.replace(/\s+/g, ' ')} `;
	for (let key in aliases) {
		name = name.split(` ${key} `).join(` ${aliases[key]} `);
	}
	name = ` ${name.replace(/\s+/g, ' ')} `;
	return name.trim();
}
function addAlias(actual, alias) {
	actual = normaliseTypeName(actual);
	alias = normaliseTypeName(alias);
	if (actual != alias) aliases[alias] = actual;
}

function updateStandardTypes(api) {
	let types = api.types;
	types.float = {
		type: "scalar",
		size: 4,
		align: 4
	};
	types.double = {
		type: "scalar",
		size: 8,
		align: 8
	};
	types.int8 = {
		type: "scalar",
		size: 1,
		align: 1
	};
	types.uint8 = {
		type: "scalar",
		size: 1,
		align: 1
	};
	types.int16 = {
		type: "scalar",
		size: 2,
		align: 2
	};
	types.uint16 = {
		type: "scalar",
		size: 2,
		align: 2
	};
	types.int32 = {
		type: "scalar",
		size: 4,
		align: 4
	};
	types.uint32 = {
		type: "scalar",
		size: 4,
		align: 4
	};
}

function updateJSON(path) {
	let json = JSON.parse(fs.readFileSync(path, 'utf8'));
	updateApi(json);
	fs.writeFileSync(path, JSON.stringify(json, null, '\t'));
}

updateJSON("../wclap32.json");
updateJSON("../wclap64.json");

function addDir(api, path) {
	let files = fs.readdirSync(clapPathPrefix + path);
	files.forEach(file => {
		if (/\.h$/.test(file)) addFile(api, `${path}/${file}`);
	});
}

function addFile(api, path) {
	let code = fs.readFileSync(`${clapPathPrefix}${path}`, 'utf8');

	// catch numeric constants
	code.replaceAll(/#define\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+([0-9]+)/g, (match, name, value) => {
		api.constants[name] = parseInt(value);
	});

	// catch simple typedefs
	code.replaceAll(/typedef\s+([^\{\};]+)\s+([a-zA-Z_][a-zA-Z0-9_]*);/g, (match, typeName, alias) => {
		addAlias(typeName, alias);
	});

	// Catch typedef'd structs, which are the main API type
	let parts = code.split('\ntypedef struct ');
	parts.slice(1).forEach((code, sliceIndex) => {
		let name = code.split(/\s/, 1)[0];

		// Extract fields
		let body = code.substr(name.length).split(name + '_t')[0].trim();
		if (body[0] != '{' || body[body.length - 1] != '}') {
			throw `${name}: couldn't find {...}`;
		}
		body = body.substr(1, body.length - 2);
		body = body.replace(/\/\/[^\n]*/g, ''); // strip comments
		let fields = body.split(';').map(x => x.trim()).filter(x => x.length);

		api.types[name] = defineStruct(name, fields);
	});
}

function defineStruct(name, fields) {
	return {
		type: "struct",
		fields: []
	};
	fields.forEach(code => {
		let dataMatch = code.match(/^(.*[^a-zA-Z_])([a-zA-Z_][a-zA-Z0-9_]*)(\[([0-9]+)\])?$/);
		let methodMatch = code.match(/^(.*)\s*\(CLAP_ABI \*([a-zA-Z_][a-zA-Z0-9_]*)\)\(([^\)]*)\)$/);
		if (dataMatch) {
			let type = normaliseTypeName(dataMatch[1]);
			let name = match[2];
			let arrayCount = parseInt(dataMatch[4], 10) || null;
		} else if (methodMatch) {
			let fReturn = methodMatch[1];
			let fName = methodMatch[2];
			let fArgs = methodMatch[3].split(',').map(x => x.trim()).filter(x => x != 'void');
		} else {
			throw Error(`couldn't parse ${name} field: ${code}`);
		}
	});
}

function updateApi(api) {
	updateStandardTypes(api);
	addDir(api, "");
	addDir(api, "/factory");
	addDir(api, "/factory/draft");
	addDir(api, "/ext");
	addDir(api, "/ext/draft");
}
