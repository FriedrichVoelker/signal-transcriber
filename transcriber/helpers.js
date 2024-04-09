const DEBUG = process.env.DEBUG || false;


/**
 * 
 * @param {*} message - Log message
 * @param {String} level - Log level
 */
const log = (message, level) => {
	level = level.toUpperCase();
	if(level == "DEBUG" && !DEBUG) return;
	console.log(`[${new Date().toISOString()}] [${level}] ${message}`);
}

// Check if a string is parseable to JSON
/**
 * 
 * @param {*} str 
 * @returns Boolean
 */
const isStringParseable = (str) => {
	try {
		JSON.parse(str);
	} catch (e) {
		return false;
	}
	return true;
}

module.exports = {
	log,
	isStringParseable
}