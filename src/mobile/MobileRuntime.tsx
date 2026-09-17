import { type PropsWithChildren } from "react";
import { MobileDeviceProvider, useMobileDevice } from "./Device";
import { KeyboardProvider, useKeyboard } from "./Keyboard";

export function MobileRuntime({ children }: PropsWithChildren) {
  return (
    <MobileDeviceProvider>
      <KeyboardProvider>
        <div className="h5-runtime">
          <MobileAppViewport>{children}</MobileAppViewport>
        </div>
      </KeyboardProvider>
    </MobileDeviceProvider>
  );
}

function MobileAppViewport({ children }: PropsWithChildren) {
  const { device } = useMobileDevice();
  const keyboard = useKeyboard();

  return (
    <div
      className="mobile-app-viewport"
      data-keyboard-visible={keyboard.visible ? "true" : "false"}
      data-platform={device.platform}
      data-testid="mobile-app-viewport"
    >
      {children}
    </div>
  );
}
