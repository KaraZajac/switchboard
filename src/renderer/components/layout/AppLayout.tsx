import { ServerRail } from './ServerRail'
import { ChannelSidebar } from './ChannelSidebar'
import { ChatArea } from './ChatArea'
import { UserList } from './UserList'
import { TitleBar } from './TitleBar'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import { SettingsModal } from '../settings/SettingsModal'
import { AddServerModal } from '../server/AddServerModal'

export function AppLayout() {
  const showUserList = useUIStore((s) => s.showUserList)
  const activeModal = useUIStore((s) => s.activeModal)
  const activeServerId = useServerStore((s) => s.activeServerId)

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-900 text-gray-100">
      <div className="flex flex-1 overflow-hidden">
        {/* Server Rail */}
        <ServerRail />

        {/* Channel Sidebar — only visible when a server is active */}
        {activeServerId && <ChannelSidebar />}

        {/* Chat Area */}
        <div className="flex flex-1 flex-col">
          <TitleBar />
          <ChatArea />
        </div>

        {/* User List */}
        {activeServerId && showUserList && <UserList />}
      </div>

      {/* Modals */}
      {activeModal === 'settings' && <SettingsModal />}
      {activeModal === 'add-server' && <AddServerModal />}
    </div>
  )
}
