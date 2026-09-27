/**
 * key 名字的长度上限。表单的 `maxLength` 和服务端校验共用这一个数 ——
 * 两边各写一个迟早会漂移（表单放行、服务端拒绝，用户只看到「保存失败」）。
 */
export const API_KEY_NAME_MAX = 60;
