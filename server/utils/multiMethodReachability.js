function evaluateReachability({ icmp = null, tcp = null, snmp = null, neighbour = null, isBlocked = false }) {
  if (isBlocked) {
    return {
      status: 'UNKNOWN',
      confirmedMethod: 'none',
      isReachable: false,
      methodsChecked: [],
      methodsResponding: [],
      reason: 'Probing is blocked or unauthorized',
    };
  }

  const methodsChecked = [];
  const activeMethodsResponding = [];
  const passiveObservations = [];

  if (icmp !== null) {
    methodsChecked.push('icmp');
    if (icmp.reachable) activeMethodsResponding.push('icmp');
  }

  if (tcp !== null) {
    methodsChecked.push('tcp');
    if (tcp.reachable) activeMethodsResponding.push('tcp');
  }

  if (snmp !== null) {
    methodsChecked.push('snmp');
    if (snmp.responded) activeMethodsResponding.push('snmp');
  }

  if (neighbour !== null) {
    methodsChecked.push('neighbour');
    if (neighbour.state && neighbour.state.toLowerCase() !== 'failed') {
      passiveObservations.push('neighbour');
    }
  }

  // Active reachability requires at least one active verification method (ICMP, TCP, SNMP).
  // Neighbour-cache evidence alone must not prove current reachability.
  const isReachable = activeMethodsResponding.length > 0;
  const methodsResponding = [...activeMethodsResponding];

  let confirmedMethod = 'none';
  if (activeMethodsResponding.length > 1) {
    confirmedMethod = 'multi';
  } else if (activeMethodsResponding.length === 1) {
    confirmedMethod = activeMethodsResponding[0];
  }

  let status = 'UNKNOWN';
  if (methodsChecked.length === 0 || (methodsChecked.length === 1 && methodsChecked[0] === 'neighbour')) {
    status = 'UNKNOWN';
  } else if (isReachable) {
    status = 'UP';
  } else {
    // If ICMP errored or execution failed rather than cleanly timed out, leave as UNKNOWN
    if (icmp && icmp.error && activeMethodsResponding.length === 0) {
      status = 'UNKNOWN';
    } else {
      status = 'DOWN';
    }
  }

  let reason;
  if (isReachable) {
    reason = `Reachability confirmed via ${methodsResponding.join(', ')}`;
  } else if (methodsChecked.length === 1 && methodsChecked[0] === 'neighbour') {
    reason = 'Neighbour cache observation present but active reachability unverified';
  } else if (icmp?.reachable === false && tcp?.reachable === false) {
    reason = 'All attempted reachability methods timed out or were refused';
  } else {
    reason = 'All attempted reachability methods timed out or were refused';
  }

  return {
    status,
    confirmedMethod,
    isReachable,
    methodsChecked,
    methodsResponding,
    passiveObservations,
    reason,
  };
}

module.exports = {
  evaluateReachability,
};
