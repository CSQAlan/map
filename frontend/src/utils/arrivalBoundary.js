// Optional server annotation only. Never infer a facility from its display name.
export function arrivalBoundaryText(route) {
  const data = route?.arrival_boundary;
  const codes = route?.segment_codes;
  if (!data || data.version !== 1 || !Array.isArray(codes) || !codes.length
      || !codes.every(code => typeof code === 'string' && code.trim())
      || typeof data.last_segment_code !== 'string' || !data.last_segment_code.trim()
      || typeof data.node_code !== 'string' || !data.node_code.trim()
      || data.last_segment_code !== codes.at(-1)) return '';
  if (data.kind === 'NETWORK_NODE' && data.source === 'server-resolved-active-road-node/v1') {
    return '本路线终点为设施关联的普通路网节点；暂未记录更具体入口或内部通行，不等于已到设施门口。请现场核对，登记不保证实地通行。';
  }
  if (data.kind !== 'LOTUS_ENTRY' || data.node_code !== 'N_SY_LOTUS_ENTRY'
      || data.source !== 'SHIDAYUAN-core-endpoint-interpretation/2026-11-24/v1'
      || codes.includes('S_SY_LOTUS_ENTRY_TO_PLATFORM')) return '';
  let text = '本路线只到荷塘入口，不到内侧平台或座椅。';
  if (Number.isInteger(data.connection_step_count) && data.connection_step_count >= 0) {
    text += `入口到内侧平台的另条登记连接有 ${data.connection_step_count} 级台阶`;
    text += data.connection_ramp_recorded === false ? '，未登记坡道。' : '，坡道及现场情况请另行核对。';
  }
  return text + '这不代表现实不可到达或没有其他入口；平台、座椅和全区通行未经本路线核验，请现场核对。';
}
