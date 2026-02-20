// Parse duration strings like "5m", "500ms", "30s", "1h"
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/)
  if (!match) throw new Error(`Invalid duration: "${duration}"`)
  
  const value = parseFloat(match[1])
  const unit = match[2]
  
  switch (unit) {
    case "ms": return value
    case "s": return value * 1000
    case "m": return value * 60 * 1000
    case "h": return value * 60 * 60 * 1000
    default: throw new Error(`Unknown unit: ${unit}`)
  }
}
