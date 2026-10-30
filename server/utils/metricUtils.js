function validNumbers(values) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value));
}

function computeStats(values) {
  const numbers = validNumbers(values);
  if (numbers.length === 0) {
    return { avg: null, min: null, max: null, stddev: null, count: 0 };
  }

  const avg = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / numbers.length;
  return {
    avg,
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    stddev: Math.sqrt(variance),
    count: numbers.length,
  };
}

function computeJitter(values) {
  const numbers = validNumbers(values);
  if (numbers.length < 2) return null;

  let totalDifference = 0;
  for (let index = 1; index < numbers.length; index += 1) {
    totalDifference += Math.abs(numbers[index] - numbers[index - 1]);
  }
  return totalDifference / (numbers.length - 1);
}

function computeAvailability(successful, total) {
  if (!Number.isFinite(successful) || !Number.isFinite(total) || total <= 0 || successful < 0 || successful > total) {
    return null;
  }
  return (successful / total) * 100;
}

function computeThroughputBps(deltaOctets, elapsedSeconds) {
  if (!Number.isFinite(deltaOctets) || deltaOctets < 0 || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return null;
  }
  return (deltaOctets * 8) / elapsedSeconds;
}

function computePPS(deltaPackets, elapsedSeconds) {
  if (!Number.isFinite(deltaPackets) || deltaPackets < 0 || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return null;
  }
  return deltaPackets / elapsedSeconds;
}

function computeCounterDelta(previous, current, elapsedSeconds, widthBits = 64) {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous < 0 || current < 0 ||
      !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 ||
      !Number.isInteger(widthBits) || widthBits < 1 || widthBits > 64) {
    return null;
  }
  if (current >= previous) return current - previous;

  const modulus = 2 ** widthBits;
  if (previous >= modulus * 0.9 && current <= modulus * 0.1) {
    return (modulus - previous) + current;
  }
  return null;
}

module.exports = {
  computeStats,
  computeJitter,
  computeAvailability,
  computeThroughputBps,
  computePPS,
  computeCounterDelta,
};
