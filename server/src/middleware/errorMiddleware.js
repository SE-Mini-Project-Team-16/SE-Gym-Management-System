/**
 * Standardized API error helper ensuring consistent error structure:
 * { error: true, message: "...", code: <HTTP_STATUS> } per SAD §4.4.
 */
export const apiError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = status;
  err.error = true;
  return err;
};

/**
 * Global API error handling middleware.
 */
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === "entity.parse.failed") {
    error = apiError(400, "Request body must contain valid JSON.");
  }
  const databaseError =
    error.name?.startsWith("Mongo") || error.name === "MongooseError";
  const status = error.status || error.code || (databaseError ? 503 : 500);
  res.status(status).json({
    error: true,
    message:
      status >= 500
        ? "Service temporarily unavailable. Please try again."
        : error.message,
    code: status,
  });
}
