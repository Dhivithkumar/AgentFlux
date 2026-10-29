"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationStatus = exports.Role = void 0;
var Role;
(function (Role) {
    Role["OWNER"] = "OWNER";
    Role["MEMBER"] = "MEMBER";
})(Role || (exports.Role = Role = {}));
var IntegrationStatus;
(function (IntegrationStatus) {
    IntegrationStatus["CONNECTED"] = "CONNECTED";
    IntegrationStatus["DISCONNECTED"] = "DISCONNECTED";
    IntegrationStatus["RECONNECT_REQUIRED"] = "RECONNECT_REQUIRED";
    IntegrationStatus["ERROR"] = "ERROR";
})(IntegrationStatus || (exports.IntegrationStatus = IntegrationStatus = {}));
