export function parseTimeToSeconds(timeValue: string, timeUnit: string): number {
    const value = parseInt(timeValue, 10);
    if (isNaN(value) || value <= 0) return 0;

    switch (timeUnit.toLowerCase()) {
        case "s": return value;
        case "m": return value * 60;
        case "h": return value * 60 * 60;
        case "d": return value * 60 * 60 * 24;
        default: return 0;
    }
}