import { useMemo } from 'react'
import { ServerRail } from './ServerRail'
import { ChannelSidebar } from './ChannelSidebar'
import { DMSidebar } from './DMSidebar'
import { ChatArea } from './ChatArea'
import { UserList } from './UserList'
import { TitleBar } from './TitleBar'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import { SettingsModal } from '../settings/SettingsModal'
import { AddServerModal } from '../server/AddServerModal'
import { WhoisModal } from '../user/WhoisModal'
import { SearchModal } from '../chat/SearchModal'
import { QuickSwitcher } from '../common/QuickSwitcher'

export function AppLayout() {
  const showUserList = useUIStore((s) => s.showUserList)
  const activeModal = useUIStore((s) => s.activeModal)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const dmMode = useUIStore((s) => s.dmMode)

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-900 text-gray-100">
      {/* Draggable title bar region for macOS window controls */}
      <div
        className="h-9 w-full flex-shrink-0 bg-gray-950"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Server Rail */}
        <ServerRail />

        {/* Sidebar — DMs or Channels */}
        {dmMode ? <DMSidebar /> : activeServerId && <ChannelSidebar />}

        {/* Chat Area */}
        <div className="flex flex-1 flex-col">
          <TitleBar />
          <ChatArea />
        </div>

        {/* User List — hide for DMs */}
        {activeServerId && showUserList && !dmMode && <UserList />}
      </div>

      {/* Modals */}
      {activeModal === 'settings' && <SettingsModal />}
      {activeModal === 'add-server' && <AddServerModal />}
      {activeModal === 'edit-server' && <EditServerModal />}
      {activeModal === 'whois' && <WhoisModal />}
      {activeModal === 'search' && <SearchModal />}
      {activeModal === 'quick-switcher' && <QuickSwitcher />}
    </div>
  )
}

function EditServerModal() {
  const editServerId = useUIStore((s) => s.editServerId)
  const servers = useServerStore((s) => s.servers)
  const server = useMemo(
    () => servers.find((s) => s.id === editServerId),
    [servers, editServerId]
  )
  if (!server) return null
  return <AddServerModal editServer={server} />
}
