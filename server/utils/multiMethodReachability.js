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
  const methodsResponding = [];

  if (icmp !== null) {
    methodsChecked.push('icmp');
    if (icmp.reachable) methodsResponding.push('icmp');
  }

  if (tcp !== null) {
    methodsChecked.push('tcp');
    if (tcp.reachable) methodsResponding.push('tcp');
  }

  if (snmp !== null) {
    methodsChecked.push('snmp');
    if (snmp.responded) methodsResponding.push('snmp');
  }

  if (neighbour !== null) {
    methodsChecked.push('neighbour');
    if (neighbour.state && neighbour.state.toLowerCase() !== 'failed') {
      methodsResponding.push('neighbour');
    }
  }

  const isReachable = methodsResponding.length > 0;
  let confirmedMethod = 'none';
  if (methodsResponding.length > 1) {
    confirmedMethod = 'multi';
  } else if (methodsResponding.length === 1) {
    confirmedMethod = methodsResponding[0];
  }

  let status = 'UNKNOWN';
  if (methodsChecked.length === 0) {
    status = 'UNKNOWN';
  } else if (isReachable) {
    status = 'UP';
  } else {
    // If ICMP errored or execution failed rather than cleanly timed out, leave as UNKNOWN
    if (icmp && icmp.error && methodsResponding.length === 0) {
      status = 'UNKNOWN';
    } else {
      status = 'DOWN';
    }
  }

  return {
    status,
    confirmedMethod,
    isReachable,
    methodsChecked,
    methodsResponding,
    reason: isReachable
      ? `Reachability confirmed via ${methodsResponding.join(', ')}`
      : 'All attempted reachability methods timed out or were refused',
  };
}

module.exports = {
  evaluateReachability,
};
