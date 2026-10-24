import { useEffect, useState } from "react";
import AgentDashboard from "./AgentDashboard";
import WorkflowProjectTasks from './WorkflowProjectTasks';
import type { AgentServerIndicator, NotificationOpenTarget } from '../desktop';

// Navigation hides the workspace; it must not discard the owner of live runs.
export default function PersistentAgentPage({ visible, onWorkflow, notificationTarget, onNotificationHandled, onServerStatus }: {
  visible: boolean;
  onWorkflow?: (id: string) => void;
  notificationTarget: Extract<NotificationOpenTarget, { type: 'agent' }> | null;
  onNotificationHandled: (notificationId: string) => void;
  onServerStatus: (status: AgentServerIndicator | null) => void;
}) {
  const [visited, setVisited] = useState(visible);
  useEffect(() => { if (visible) setVisited(true); }, [visible]);
  return <div className="persistent-agent-page" hidden={!visible} inert={!visible} aria-hidden={!visible}
    style={{ display: visible ? "flex" : "none",flexDirection:'column', height: "100%", minHeight: 0 }}>
    {visited && <><WorkflowProjectTasks onReview={onWorkflow}/><div style={{flex:1,minHeight:0}}><AgentDashboard notificationTarget={notificationTarget} onNotificationHandled={onNotificationHandled} onServerStatus={onServerStatus} visible={visible} /></div></>}
  </div>;
}
