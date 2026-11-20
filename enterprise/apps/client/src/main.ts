import {createSSRApp} from 'vue'
import App from './App.vue'
import {setupH5} from './lib/h5-bootstrap'
import {initializeClientTheme,refreshClientTheme} from './lib/client-theme'
export function createApp(){setupH5();initializeClientTheme();const app=createSSRApp(App);app.mixin({onShow(){void refreshClientTheme()}});return{app}}
