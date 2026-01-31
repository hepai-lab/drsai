import { graphql } from "gatsby";
import * as React from "react";
import MagenticUILayout from "../components/layout";

// markup
const IndexPage = ({ data }: any) => {
  // 路由保护由 RouteGuard 组件统一处理

  // return (
  //   <MagenticUILayout meta={data.site.siteMetadata} title="Home" link={"/"}>
  //     <main style={{ height: "100%" }} className=" h-full ">
  //       {/* 显示token和用户名 */}
  //       {token && username && (
  //         <div>
  //           <div>欢迎，{username}！</div>
  //           <div>Token: <code style={{ wordBreak: "break-all" }}>{token}</code></div>
  //         </div>
  //       )}
  //     </main>
  //   </MagenticUILayout>
  // );

  return (
    <MagenticUILayout meta={data.site.siteMetadata} title="Home" link={"/"}>
      <main style={{ height: "100%" }} className=" h-full ">
      </main>
    </MagenticUILayout>
  );
};



export const query = graphql`
  query HomePageQuery {
    site {
      siteMetadata {
        description
        title
      }
    }
  }
`;

export default IndexPage;
