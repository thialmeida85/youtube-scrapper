function suppressKnownRuntimeWarnings() {
  const originalEmitWarning = process.emitWarning;

  process.emitWarning = function emitWarning(message, ...args) {
    const text = typeof message === "string" ? message : message?.message || "";
    const warningType = typeof args[0] === "string" ? args[0] : args[0]?.type;

    if (
      warningType === "ExperimentalWarning" &&
      text.includes("The Fetch API is an experimental feature")
    ) {
      return;
    }

    return originalEmitWarning.call(process, message, ...args);
  };
}

module.exports = {
  suppressKnownRuntimeWarnings,
};
