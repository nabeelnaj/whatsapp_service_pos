function createLockSafeLocalAuth(LocalAuthClass) {
    return class LockSafeLocalAuth extends LocalAuthClass {
        async logout() {
            if (this.client?.pupBrowser?.isConnected?.()) return;
            return super.logout();
        }
    };
}

module.exports = { createLockSafeLocalAuth };
