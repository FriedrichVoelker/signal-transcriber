const LOG_LEVEL = process.env.LOG_LEVEL || "INFO";


/**
 * 
 * @param {*} message - Log message
 * @param {String} level - Log level
 */
const log = (message, level) => {

	const LEVELS = {
		DEBUG: 0,
		ERROR: 1,
		INFO: 2,
	};

	// Set default log level to INFO
	if(!level) level = "INFO";
	level = level.toUpperCase();

	// Check if the log level is valid
	if(!Object.keys(LEVELS).includes(level)) {
		log(`Invalid log level: ${level}`, "ERROR");
		return;
	}

	// Check if the log level is LOG_LEVEL or smaller
	if(LEVELS[level] < LEVELS[LOG_LEVEL.toUpperCase()]) return;

	// Log the message in format: [ISO Date] [LOG LEVEL] MESSAGE
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