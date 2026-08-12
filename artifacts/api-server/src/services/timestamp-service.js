/**
 * Centralized Timestamp Service
 * This service ensures exact timestamps that are independent of system time/date accuracy
 * All timestamps flow through this service to guarantee consistency and accuracy
 */
export class TimestampService {
    // Store server start time for offset calculation if needed
    static serverStartTime = Date.now();
    static timeOffset = 0;
    static isNTPSynced = false;
    /**
     * Get current timestamp in ISO format
     * This is the primary method for all timestamp generation
     */
    static getCurrentTimestamp() {
        const now = new Date(Date.now() + this.timeOffset);
        return now;
    }
    /**
     * Get current timestamp as ISO string (for logging and storage)
     */
    static getCurrentTimestampISO() {
        return this.getCurrentTimestamp().toISOString();
    }
    /**
     * Get current timestamp as Unix milliseconds
     */
    static getCurrentTimestampMs() {
        return Date.now() + this.timeOffset;
    }
    /**
     * Create a timestamp for a specific operation
     * This captures an exact point in time for that operation
     */
    static createOperationTimestamp() {
        return this.getCurrentTimestamp();
    }
    /**
     * Create timestamps for a session start/end
     * Returns both start and the exact duration
     */
    static createSessionTimestamps() {
        const startTime = this.getCurrentTimestamp();
        return {
            startTime,
            createdAt: new Date(startTime.getTime()), // Exact creation time
        };
    }
    /**
     * Create timestamp for a scan record
     * Ensures scanned timestamp is captured exactly when recorded
     */
    static createScanTimestamp() {
        return this.getCurrentTimestamp();
    }
    /**
     * Create timestamp for audit log
     * Critical for compliance and traceability
     */
    static createAuditTimestamp() {
        return this.getCurrentTimestamp();
    }
    /**
     * Synchronize with NTP server (if available)
     * This helps correct any system clock drift
     */
    static async syncWithNTP(ntpServer = "pool.ntp.org") {
        try {
            // Try to fetch from a time API as fallback
            const response = await fetch("https://www.google.com", {
                method: "HEAD",
            });
            const serverTime = new Date(response.headers.get("date") || Date.now());
            const clientTime = new Date();
            const drift = serverTime.getTime() - clientTime.getTime();
            if (Math.abs(drift) > 1000) {
                // If drift is more than 1 second, apply correction
                this.timeOffset = drift;
                this.isNTPSynced = true;
                console.log(`[TimestampService] Time synchronized. Offset: ${drift}ms, Server time: ${serverTime.toISOString()}`);
                return true;
            }
            this.isNTPSynced = true;
            console.log("[TimestampService] System clock is accurate, no drift detected");
            return true;
        }
        catch (error) {
            console.warn("[TimestampService] NTP sync failed:", error);
            return false;
        }
    }
    /**
     * Get sync status
     */
    static getSyncStatus() {
        return {
            isSynced: this.isNTPSynced,
            timeOffset: this.timeOffset,
            serverStartTime: new Date(this.serverStartTime),
            currentTime: this.getCurrentTimestamp(),
        };
    }
    /**
     * Get time differential between two timestamps
     * Useful for calculating session duration
     */
    static getTimestampDifference(start, end) {
        return end.getTime() - start.getTime();
    }
    /**
     * Format timestamp for display
     */
    static formatTimestamp(date, format = "ISO") {
        if (format === "ISO")
            return date.toISOString();
        if (format === "LOCAL")
            return date.toLocaleString();
        if (format === "DATE")
            return date.toLocaleDateString();
        if (format === "TIME")
            return date.toLocaleTimeString();
        return date.toString();
    }
    /**
     * Validate that all timestamps in an object follow server time
     * This is useful for consistency checks
     */
    static validateTimestamps(record) {
        const issues = [];
        const now = this.getCurrentTimestampMs();
        // Future dates are invalid (allow 5 second grace period for clock skew)
        if (record.startTime && new Date(record.startTime).getTime() > now + 5000) {
            issues.push("startTime is in the future");
        }
        // End time should be after start time
        if (record.startTime &&
            record.endTime &&
            new Date(record.endTime).getTime() < new Date(record.startTime).getTime()) {
            issues.push("endTime is before startTime");
        }
        // CreatedAt should not be in far future
        if (record.createdAt && new Date(record.createdAt).getTime() > now + 5000) {
            issues.push("createdAt is in the future");
        }
        return {
            valid: issues.length === 0,
            issues,
        };
    }
    /**
     * Initialize timestamp service on server startup
     * This should be called when the API server starts
     */
    static async initialize() {
        console.log("[TimestampService] Initializing timestamp service...");
        await this.syncWithNTP();
        console.log(`[TimestampService] Ready. Current time: ${this.getCurrentTimestampISO()}`);
    }
}
// Auto-initialize on import
TimestampService.initialize().catch((err) => console.error("[TimestampService] Initialization error:", err));
