export function toolResult(summary, data) {
    const response = {
        summary,
        data,
        generatedAt: new Date().toISOString(),
    };
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
    };
}
export function toolError(message) {
    return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
    };
}
export function mean(values) {
    if (values.length === 0)
        return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}
export function stddev(values) {
    if (values.length <= 1)
        return 0;
    const avg = mean(values);
    const squareDiffs = values.map(v => (v - avg) ** 2);
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
}
export function pctChange(current, previous) {
    if (previous === 0)
        return null;
    return ((current - previous) / Math.abs(previous)) * 100;
}
export function ragStatus(value, target, lowerIsBetter) {
    if (lowerIsBetter) {
        if (value <= target)
            return 'green';
        if (value <= target * 1.1)
            return 'amber';
        return 'red';
    }
    if (value >= target)
        return 'green';
    if (value >= target * 0.9)
        return 'amber';
    return 'red';
}
//# sourceMappingURL=helpers.js.map