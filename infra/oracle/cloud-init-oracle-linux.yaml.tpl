#cloud-config
package_update: false
write_files:
  - path: /opt/integritas/bootstrap-oracle-linux.sh
    owner: root:root
    permissions: '0750'
    encoding: b64
    content: __BOOTSTRAP_B64__
  - path: /opt/integritas/openclaw/install-native.sh
    owner: root:root
    permissions: '0750'
    encoding: b64
    content: __INSTALLER_B64__
  - path: /opt/integritas/openclaw/openclaw.json5
    owner: root:root
    permissions: '0640'
    encoding: b64
    content: __CONFIG_B64__
  - path: /opt/integritas/openclaw/openclaw-gateway.service
    owner: root:root
    permissions: '0644'
    encoding: b64
    content: __SERVICE_B64__
  - path: /etc/sudoers.d/101-integritas-openclaw-run-command
    owner: root:root
    permissions: '0440'
    content: |
      Cmnd_Alias INTEGRITAS_OC_SERVICE = /usr/bin/systemctl is-active openclaw-gateway.service, /usr/bin/systemctl status openclaw-gateway.service --no-pager, /usr/bin/systemctl restart openclaw-gateway.service
      Cmnd_Alias INTEGRITAS_OC_LOGS = /usr/bin/journalctl -u openclaw-gateway.service -n 200 --no-pager
      Cmnd_Alias INTEGRITAS_OC_STATUS = /usr/bin/env OPENCLAW_CONFIG_PATH=/etc/openclaw/openclaw.json OPENCLAW_STATE_DIR=/var/lib/openclaw HOME=/var/lib/openclaw /opt/openclaw/bin/openclaw gateway status --deep --require-rpc, /usr/bin/env OPENCLAW_CONFIG_PATH=/etc/openclaw/openclaw.json OPENCLAW_STATE_DIR=/var/lib/openclaw HOME=/var/lib/openclaw /opt/openclaw/bin/openclaw sandbox list --json
      ocarun ALL=(root) NOPASSWD: INTEGRITAS_OC_SERVICE, INTEGRITAS_OC_LOGS
      ocarun ALL=(openclaw) NOPASSWD: INTEGRITAS_OC_STATUS
runcmd:
  - [ bash, /opt/integritas/bootstrap-oracle-linux.sh ]
  - [ bash, /opt/integritas/openclaw/install-native.sh ]
  - [ systemctl, enable, --now, oracle-cloud-agent ]
final_message: "Integritas Oracle Linux/OpenClaw bootstrap finished. OCI Run Command is limited to explicit service and health operations."
