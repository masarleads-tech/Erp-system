; Let tablets and phones on the WiFi reach the POS (ports 8080-8090) - private networks only
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Basita POS"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Basita POS" dir=in action=allow protocol=TCP localport=8080-8090 profile=private,domain'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Basita POS" dir=in action=allow program="$INSTDIR\Basita.exe" profile=private,domain'
!macroend
!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Basita POS"'
!macroend
