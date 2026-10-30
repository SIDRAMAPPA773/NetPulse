const DEVELOPMENT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const parseOrigins = (configuredOrigins, nodeEnv) => {
  const originValues = configuredOrigins === undefined
    ? (nodeEnv === 'development' ? DEVELOPMENT_ORIGINS : [])
    : configuredOrigins.split(',');

  return originValues
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      let parsedOrigin;
      try {
        parsedOrigin = new URL(origin);
      } catch {
        throw new Error(`Invalid CLIENT_ORIGIN value: ${origin}`);
      }

      if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
        throw new Error(`CLIENT_ORIGIN must contain only HTTP(S) origins without paths: ${origin}`);
      }

      return origin;
    });
};

const createCorsOrigin = (configuredOrigins, nodeEnv) => {
  const allowedOrigins = new Set(parseOrigins(configuredOrigins, nodeEnv));

  return (origin, callback) => {
    callback(null, origin === undefined || allowedOrigins.has(origin));
  };
};

module.exports = createCorsOrigin;
