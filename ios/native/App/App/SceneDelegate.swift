import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // Launched from a `wizard://connect` link (e.g. the Camera app on the Setup QR): open on the connect screen.
        if let url = connectionOptions.urlContexts.first?.url { WizardAddress.receive(url) }

        window = UIWindow(windowScene: windowScene)
        window?.backgroundColor = UIColor(red: 0x05 / 255, green: 0x03 / 255, blue: 0x0c / 255, alpha: 1)
        window?.rootViewController = WizardViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // A `wizard://connect` link while the app runs: show it on the connect screen. Nothing switches until the owner
        // confirms and the address passes the Wizard check.
        if let url = URLContexts.first?.url, WizardAddress.receive(url) {
            WizardViewController.restart(in: window)
            return
        }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
