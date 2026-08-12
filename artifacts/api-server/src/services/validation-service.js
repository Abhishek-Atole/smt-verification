import { db } from "@workspace/db";
import { bomItemsTable, sessionsTable } from "@workspace/db/schema";
import { ComponentService } from "./component-service";
import { FeederService } from "./feeder-service";
import { eq, and } from "drizzle-orm";
import Fuse from "fuse.js";
const FUZZY_THRESHOLD = 0.95;
const SUGGESTION_COUNT = 3;
const OCRERROR_MAPPINGS = {
    '0': ['O'],
    'O': ['0'],
    '1': ['l', 'I'],
    'l': ['1', 'I'],
    'I': ['1', 'l'],
    'S': ['5'],
    '5': ['S'],
    'B': ['8'],
    '8': ['B'],
};
export class ValidationService {
    /**
     * Core validation logic - validates component scan against BOM
     *
     * Workflow:
     * 1. Look up BOM item by (sessionId → bomId, feederId)
     * 2. Get expected component and part ID
     * 3. If scannedMpn == expected MPN → PASS
     * 4. Else if scannedMpn in approved alternates → PASS (log as alternate)
     * 5. Else → FAIL
     */
    static async validateComponentMatch(sessionId, feederId, scannedMpn) {
        try {
            // Get session to find BOM
            const sessionResult = await db
                .select()
                .from(sessionsTable)
                .where(eq(sessionsTable.id, sessionId));
            if (sessionResult.length === 0) {
                return {
                    status: "mismatch",
                    message: "Session not found",
                    scannedMpn,
                    alternateUsed: false,
                    validationResult: "session_not_found",
                };
            }
            const session = sessionResult[0];
            const bomId = session.bomId;
            // Check if this is Free Scan Mode (bomId is NULL)
            if (bomId === null) {
                // Free Scan Mode: Accept any component without verification
                return {
                    status: "pass",
                    message: `✓ Component scanned (Free Scan Mode — no BOM validation): ${scannedMpn}`,
                    scannedMpn,
                    alternateUsed: false,
                    validationResult: "pass_free_scan",
                };
            }
            // Get feeder to validate it exists
            const feeder = await FeederService.getFeederByFeederId(feederId);
            if (!feeder) {
                return {
                    status: "feeder_not_found",
                    message: `Feeder ${feederId} not found or inactive`,
                    scannedMpn,
                    alternateUsed: false,
                    validationResult: "feeder_not_found",
                };
            }
            // Get BOM item for this feeder in this BOM
            const bomItemResult = await db
                .select()
                .from(bomItemsTable)
                .where(and(eq(bomItemsTable.bomId, bomId), eq(bomItemsTable.feederId, feeder.id)));
            if (bomItemResult.length === 0) {
                return {
                    status: "mismatch",
                    message: `No BOM item found for feeder ${feederId} in this BOM`,
                    scannedMpn,
                    alternateUsed: false,
                    validationResult: "bom_item_not_found",
                };
            }
            const bomItem = bomItemResult[0];
            const expectedMpn = bomItem.expectedMpn;
            const componentId = bomItem.componentId;
            if (!expectedMpn || !componentId) {
                return {
                    status: "mismatch",
                    message: `BOM item incomplete - missing component mapping`,
                    scannedMpn,
                    alternateUsed: false,
                    validationResult: "incomplete_bom_item",
                };
            }
            // Check if scanned MPN matches expected
            if (scannedMpn === expectedMpn) {
                return {
                    status: "pass",
                    message: `✓ Correct component: ${scannedMpn}`,
                    expectedMpn,
                    scannedMpn,
                    matchedComponentId: componentId,
                    alternateUsed: false,
                    validationResult: "pass",
                };
            }
            // Check if scanned MPN is approved alternate
            const scannedComponent = await ComponentService.getComponentByMpn(scannedMpn);
            if (!scannedComponent) {
                return {
                    status: "mismatch",
                    message: `Component ${scannedMpn} not found in component master`,
                    expectedMpn,
                    scannedMpn,
                    alternateUsed: false,
                    validationResult: "component_not_found",
                };
            }
            // Check if this is an approved alternate
            const isApproved = await ComponentService.isAlternateApproved(componentId, scannedComponent.id);
            if (isApproved) {
                return {
                    status: "alternate_pass",
                    message: `⚠ Approved alternate: ${scannedMpn} (expected: ${expectedMpn})`,
                    expectedMpn,
                    scannedMpn,
                    matchedComponentId: scannedComponent.id,
                    alternateUsed: true,
                    validationResult: "alternate_pass",
                };
            }
            // Not approved
            return {
                status: "mismatch",
                message: `✗ Component mismatch: Expected ${expectedMpn}, got ${scannedMpn} (not approved alternate)`,
                expectedMpn,
                scannedMpn,
                alternateUsed: false,
                validationResult: "mismatch",
            };
        }
        catch (error) {
            return {
                status: "mismatch",
                message: `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
                scannedMpn,
                alternateUsed: false,
                validationResult: "error",
            };
        }
    }
    /**
     * Validate date code (optional - could check expiration)
     */
    static async validateDateCode(dateCode) {
        // Placeholder: Could implement expiration logic here
        // For now, just check format (e.g., YYWD format)
        return /^\d{4}$/.test(dateCode) || dateCode === "";
    }
    /**
     * Check for data anomalies (e.g., same MPN scanned twice in short time)
     */
    static async checkForAnomalies(sessionId, feederId, scannedMpn) {
        // Could implement logic to detect unusual patterns
        return { hasAnomaly: false };
    }
    /**
     * Normalize string for fuzzy matching
     * - Converts to uppercase
     * - Trims whitespace
     * - Removes special characters except hyphens and underscores
     */
    static normalizeForMatching(value) {
        if (!value)
            return '';
        return value
            .toUpperCase()
            .trim()
            .replace(/[^A-Z0-9-_]/g, '');
    }
    /**
     * Calculate match score using Levenshtein distance (0-100)
     * 100 = perfect match, 0 = completely different
     */
    static calculateMatchScore(input, expected) {
        const normalized1 = this.normalizeForMatching(input);
        const normalized2 = this.normalizeForMatching(expected);
        if (!normalized1 || !normalized2)
            return 0;
        if (normalized1 === normalized2)
            return 100;
        try {
            // Use Fuse.js for Levenshtein distance
            // Fuse score: 0 = perfect match, 1 = completely different
            const fuse = new Fuse([normalized2], {
                threshold: 0.3,
                includeScore: true
            });
            const results = fuse.search(normalized1);
            if (results.length === 0)
                return 0;
            const fuseScore = results[0].score || 1;
            return Math.round((1 - fuseScore) * 100);
        }
        catch (error) {
            console.error('Error calculating match score:', error);
            return 0;
        }
    }
    /**
     * Fuzzy match feeder number against list of BOM items
     * @returns { match: BOM item or null, score: 0-100, suggestions: alternatives }
     */
    static fuzzyMatchFeeder(userInput, bomItems, threshold = FUZZY_THRESHOLD) {
        if (!userInput || bomItems.length === 0) {
            return { match: null, score: 0, suggestions: [] };
        }
        const normalizedInput = this.normalizeForMatching(userInput);
        const fuseOptions = {
            keys: ['feederNumber'],
            threshold: 1 - threshold, // Fuse uses inverted threshold
            minMatchCharLength: 2,
            includeScore: true,
        };
        try {
            const fuse = new Fuse(bomItems, fuseOptions);
            const results = fuse.search(normalizedInput).slice(0, SUGGESTION_COUNT + 1);
            if (results.length === 0) {
                return { match: null, score: 0, suggestions: [] };
            }
            // Best match
            const bestResult = results[0];
            const bestMatch = bestResult.item;
            const bestScore = Math.round((1 - (bestResult.score || 1)) * 100);
            // Suggestions (alternatives if not perfect match)
            const suggestions = bestScore >= 100
                ? []
                : results.slice(1, SUGGESTION_COUNT + 1).map(r => r.item);
            return {
                match: bestMatch,
                score: bestScore,
                suggestions,
            };
        }
        catch (error) {
            console.error('Error in fuzzyMatchFeeder:', error);
            return { match: null, score: 0, suggestions: [] };
        }
    }
    /**
     * Fuzzy match MPN or Internal ID value
     * @returns { score: 0-100, matches: boolean, closestMatch: expected value }
     */
    static fuzzyMatchValue(userInput, expectedValue, threshold = FUZZY_THRESHOLD) {
        if (!userInput || !expectedValue) {
            return { score: 0, matches: false };
        }
        const normalized1 = this.normalizeForMatching(userInput);
        const normalized2 = this.normalizeForMatching(expectedValue);
        if (!normalized1 || !normalized2) {
            return { score: 0, matches: false };
        }
        // Exact match check first (fastest)
        if (normalized1 === normalized2) {
            return { score: 100, matches: true, closestMatch: normalized2 };
        }
        // Fuzzy match
        const score = this.calculateMatchScore(normalized1, normalized2);
        const matchThreshold = threshold * 100;
        const matches = score >= matchThreshold;
        return {
            score,
            matches,
            closestMatch: normalized2,
        };
    }
    /**
     * Get details about what normalizations were applied
     */
    static getNormalizationDetails(original, normalized) {
        if (!original || !normalized)
            return {};
        return {
            uppercased: original !== original.toUpperCase() && normalized === original.toUpperCase(),
            trimmed: original !== original.trim(),
            specialCharsRemoved: /[^A-Z0-9-_]/i.test(original),
        };
    }
}
