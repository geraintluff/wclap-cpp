"use strict"
const fs = require('fs');
const clapPathPrefix = __dirname + "/../modules/clap/include/clap";
const fakeCode = {
	clap_window: `{
		const char *api;
		void *ptr;
	}`
};

let constants = {
	CLAP_NAME_SIZE: 256,
	CLAP_PATH_SIZE: 1024,
	CLAP_REMOTE_CONTROLS_COUNT: 8
};
function normaliseTypeName(api, name, removeConst) {
	if (name == '*' || name == '[]' || name == '()') return name;
	name = ` ${name.replace(/\s+/g, ' ')} `;
	name = name.replace(/\*/g, ' * '); // space around pointers
	// Strip some things we don't need
	name = name.replace(/\s+struct\s+/g, ' ');
	name = name.replace(/\s+CLAP_CONSTEXPR\s+/g, ' ');
	if (removeConst) {
		name = name.replace(/\s+const\s+/g, ' ');
	}
	name = name.replace(/_t\s/g, ''); // remove _t suffix
	name = ` ${name.replace(/\s+/g, ' ')} `;
	for (let key in api.aliases) {
		name = name.split(` ${key} `).join(` ${api.aliases[key]} `);
	}
	name = ` ${name.replace(/\s+/g, ' ')} `;
	return name.trim();
}
function addAlias(api, actual, alias) {
	actual = normaliseTypeName(api, actual);
	alias = normaliseTypeName(api, alias);
	if (actual != alias) api.aliases[alias] = actual;
}
function resolveField(api, field, structName) {
	let typeName = field.type;

	if (typeName == 'void') {
		// fine
	} else if (typeName == '*' || typeName == '[]' || typeName == '()') {
		// no change
	} else if (typeName.endsWith("*")) {
		typeName = typeName.replace(/\s*\*$/, "");
		let toConst = false;
		if (/ const$/.test(typeName)) {
			toConst = true;
			typeName = typeName.replace(/ const$/, '');
		} else if (/^const [^\*]+$/.test(typeName)) {
			toConst = true;
			typeName = typeName.replace(/const /, '');
		}
		let toType = resolveField(api, {type: typeName, name: "*" + field.name}, structName);
		delete toType.name;
		return {
			name: field.name,
			type: '*',
			to: toType,
			toConst: toConst,
			size: api.pointerBytes,
			align: api.pointerBytes,
		};
	} else if (!api.types[typeName]) {
		throw Error(`unknown type for ${structName}.${field.name}: ${field.type}`);
	}
	
	return field;
}

function startApi(pointerBytes) {
	let api = {
		pointerBytes: pointerBytes,
		constants: {},
		strings: {},
		types: {},
		aliases: {
			'char': 'int8',
			'int': 'int32', // true for both wasm32 and wasm64: https://github.com/WebAssembly/design/blob/main/CAndC%2B%2B.md
			'size': `uint${pointerBytes*8}`
		}
	};
	
	let addNumber = (name, bytes) => {
		api.types[name] = {
			type: "value",
			size: bytes,
			arraySize: bytes,
			align: bytes
		};
	};
	addNumber("float", 4);
	addNumber("double", 8);
	addNumber("bool", 1);
	addNumber("int8", 1);
	addNumber("uint8", 1);
	addNumber("int16", 2);
	addNumber("uint16", 2);
	addNumber("int32", 4);
	addNumber("uint32", 4);
	addNumber("int64", 8);
	addNumber("uint64", 8);
	return api;
}

function generateJSON(path, pointerBytes) {
	let json = createApi(pointerBytes);
	fs.writeFileSync(path, JSON.stringify(json, null, '\t'));
}

generateJSON("../wclap32.json", 4);
generateJSON("../wclap64.json", 8);

function addDir(api, path) {
	let files = fs.readdirSync(clapPathPrefix + path);
	files.forEach(file => {
		if (/\.h$/.test(file)) addFile(api, `${path}/${file}`);
	});
}

function addFile(api, path) {
	let code = fs.readFileSync(`${clapPathPrefix}${path}`, 'utf8');
	code = code.replaceAll(/\/\/[^\n]*/g, ''); // remove comments
	
	code.replaceAll(/#include\s+("[^"]+")/g, (match, includePath) => {
		includePath = JSON.parse(includePath);
		if (/^private\//.test(includePath)) return;
		addFile(api, path.replace(/[^\/]*$/, '') + includePath);
	});

	// catch numeric constants
	code.replaceAll(/#define\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+([0-9]+)/g, (match, name, value) => {
		api.constants[name] = parseInt(value);
	});

	// catch #define'd string constants
	code.replaceAll(/#define\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+("[^"]*")/g, (match, name, value) => {
		api.strings[name] = JSON.parse(value);
	});

	// catch simple typedefs
	code.replaceAll(/typedef\s+([^\{\};]+)\s+([a-zA-Z_][a-zA-Z0-9_]*);/g, (match, typeName, alias) => {
		addAlias(api, typeName, alias);
	});
	
	// catch enum constants
	code.replaceAll(/enum\s+\{([^\}]+)\}/g, (match, body) => {
		body.replaceAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s+=([^\,]+)/g, (match, name, value) => {
			value = value.trim();
			try {
				// There are a few different syntaxes here, and JS is close enough to C for this to work
				value = eval(value);
			} catch (e) {
				throw Error(`couldn't understand enum constant: ${name} = ${value}`);
			}
			api.constants[name] = value;
		});
	});

	// Catch typedef'd structs, which are the main API type
	let parts = code.split('\ntypedef struct ');
	parts.slice(1).forEach((code, sliceIndex) => {
		let name = code.split(/\s/, 1)[0];

		// Extract fields
		let body = code.substr(name.length).split(name + '_t')[0].trim();
		if (name in fakeCode) body = fakeCode[name];
		if (body[0] != '{' || body[body.length - 1] != '}') {
			throw `${name}: couldn't find {...}`;
		}
		body = body.substr(1, body.length - 2);
		let fields = body.split(';').map(x => x.trim()).filter(x => x.length);

		api.types[name] = {};
		fillStructType(api, name, fields);
	});

	// catch static constants
	code.replaceAll(/static\s+([^\;]+)/g, (match, line) => {
		if (/^inline\s/.test(line)) {
			return; // inline helper function, ignore it
		}
		let parts = line.split('=');
		if (parts.length != 2) throw Error("couldn't find `=` in static line: " + line);

		let def = parts[0].trim();
		let name = def.split(/\s+/g).pop();
		let type = def.substr(0, def.length - name.length).trim();
		type = normaliseTypeName(api, type, true);
		let value = parts[1].trim();
		if (/^"[^"]+"$/.test(value)) {
			api.strings[name] = JSON.parse(value);
		} else if (type in api.types) {
			type = api.types[type];
			if (type.type == 'struct') {
				// TODO: we're ignoring this for now
			}
		} else {
			console.error([type, name, value]);
			throw Error("couldn't parse static constant: " + line);
		}
	});
}

function fillStructType(api, name, fields) {
	let struct = api.types[name];
	Object.assign(struct, {
		type: "struct",
		fields: [],
		size: 0,
		align: 1,
	});
	let currentOffset = 0;
	let hasPointer = false;
	function addField(field) {
		field = resolveField(api, field, name);
		while (currentOffset%field.align) ++currentOffset;
		field.offset = currentOffset;
		struct.size = currentOffset += field.size;
		struct.fields.push(field);
	}

	fields.forEach(code => {
		let dataMatch = code.match(/^(.*[^a-zA-Z_])([a-zA-Z_][a-zA-Z0-9_]*)(\[([^\]]+)\])?$/);
		let methodMatch = code.match(/^(.*)\s*\(CLAP_ABI \*([a-zA-Z_][a-zA-Z0-9_]*)\)\(([^\)]*)\)$/);
		if (dataMatch) {
			let type = normaliseTypeName(api, dataMatch[1]);
			let field = {
				type: type,
				name: dataMatch[2]
			};
			field = resolveField(api, field, name); // fills out size/align

			let array = dataMatch[4];
			if (array) {
				let arrayCount = parseInt(array, 10);
				if (array in api.constants) arrayCount = api.constants[array];
				if (!arrayCount) {
					throw Error(`invalid array length for ${name}.${field}: ${array}`);
				}
				let arraySize = field.size;
				while (arraySize%field.align) ++arraySize;
				field = {
					type: '[]',
					count: arrayCount,

					name: field.name,
					size: arrayCount*arraySize,
					align: field.align
				};
			}
			addField(field);
		} else if (methodMatch) {
			let methodName = methodMatch[2];
			let resultType = {
				type: normaliseTypeName(api, methodMatch[1]),
				name: 'result'
			};
			resultType = resolveField(api, resultType, `${name}.${methodName} return`);
			let field = {
				name: methodName,
				type: '()',
				result: resultType,
				args: [],
				size: api.pointerBytes,
				align: api.pointerBytes,
			};

			let args = methodMatch[3].split(',').map(x => x.trim()).filter(x => x != 'void');
			args.forEach(arg => {
				let argMatch = arg.match(/^(.*[^a-zA-Z_])([a-zA-Z_][a-zA-Z0-9_]*)$/);
				if (!argMatch) {
					throw Error(`Couldn't parse arg for ${name}.${field.name}(): ${arg}`);
				}
				let argType = {
					type: normaliseTypeName(api, argMatch[1]),
					name: argMatch[2]
				};
				// Warn about possible mis-parses, if the variable is also a type (and not "size")
				if (argType.name != 'size' && api.types[normaliseTypeName(api, argType.name)]) {
					console.log("suspicious argument name:", argType, args);
				}
				argType = resolveField(api, argType, `${name}.${field.name}()`);
				field.args.push(argType);
			});

			addField(field);
		} else {
			throw Error(`couldn't parse ${name} field: ${code}`);
		}
	});
	return struct;
}

function createApi(pointerBytes) {
	let api = startApi(pointerBytes);
	addDir(api, "");
	addDir(api, "/factory");
	addDir(api, "/factory/draft");
	addDir(api, "/ext");
	addDir(api, "/ext/draft");
	return api;
}
