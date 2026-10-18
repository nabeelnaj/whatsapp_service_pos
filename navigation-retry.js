function isNavigationError(error) {
    return /Execution context was destroyed|Cannot find context with specified id/i.test(error?.message || '');
}

async function runWithNavigationRetry(operation, { wait }) {
    try {
        return await operation();
    } catch (error) {
        if (!isNavigationError(error)) {
            throw error;
        }

        await wait();
        return operation();
    }
}

module.exports = { isNavigationError, runWithNavigationRetry };
