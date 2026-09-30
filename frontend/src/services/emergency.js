export function buildSosPayload({ user, isGuest, mobilityType, selectedRoute, currentStep, destination }) {
  return {
    elder_user_id: user?.role === 'elder' ? user.id : null,
    elder_name: user?.realName || (isGuest ? '访客' : '演示老人'),
    mobility_type: mobilityType,
    route_summary: selectedRoute?.summary ?? null,
    current_step: currentStep,
    destination_name: destination?.label ?? null,
  };
}
