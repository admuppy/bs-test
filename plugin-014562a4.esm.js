import { createApiRef, createRouteRef, createPlugin, createApiFactory, discoveryApiRef, identityApiRef, configApiRef, createRoutableExtension } from '@backstage/core-plugin-api';
import { scmAuthApiRef, scmIntegrationsApiRef } from '@backstage/integration-react';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { Octokit } from '@octokit/rest';
import { Base64 } from 'js-base64';
import parseGitUrl from 'git-url-parse';

const catalogImportApiRef = createApiRef({
  id: "plugin.catalog-import.service"
});

const getGiteaIntegrationConfig = (scmIntegrationsApi, location) => {
  const integration = scmIntegrationsApi.gitea.byUrl(location);
  if (!integration) {
    return void 0;
  }
  const { name: repo, owner } = parseGitUrl(location);
  return {
    repo,
    owner,
    giteaIntegrationConfig: integration.config
  };
};

const getGithubIntegrationConfig = (scmIntegrationsApi, location) => {
  const integration = scmIntegrationsApi.github.byUrl(location);
  if (!integration) {
    return void 0;
  }
  const { name: repo, owner } = parseGitUrl(location);
  return {
    repo,
    owner,
    githubIntegrationConfig: integration.config
  };
};

function asInputRef(renderResult) {
  const { ref, ...rest } = renderResult;
  return {
    inputRef: ref,
    ...rest
  };
}
function getCatalogFilename(config) {
  var _a;
  return (_a = config.getOptionalString("catalog.import.entityFilename")) != null ? _a : "catalog-info.yaml";
}
function getBranchName(config) {
  var _a;
  return (_a = config.getOptionalString("catalog.import.pullRequestBranchName")) != null ? _a : "backstage-integration";
}

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
class CatalogImportClient {
  constructor(options) {
    __publicField(this, "discoveryApi");
    __publicField(this, "identityApi");
    __publicField(this, "scmAuthApi");
    __publicField(this, "scmIntegrationsApi");
    __publicField(this, "catalogApi");
    __publicField(this, "configApi");
    this.discoveryApi = options.discoveryApi;
    this.scmAuthApi = options.scmAuthApi;
    this.identityApi = options.identityApi;
    this.scmIntegrationsApi = options.scmIntegrationsApi;
    this.catalogApi = options.catalogApi;
    this.configApi = options.configApi;
  }
  async analyzeUrl(url) {
    var _a;
    if (new URL(url).pathname.match(/\.ya?ml$/) || ((_a = new URL(url).searchParams.get("path")) == null ? void 0 : _a.match(/.ya?ml$/))) {
      const location = await this.catalogApi.addLocation({
        type: "url",
        target: url,
        dryRun: true
      });
      return {
        type: "locations",
        locations: [
          {
            exists: location.exists,
            target: location.location.target,
            entities: location.entities.map((e) => {
              var _a2;
              return {
                kind: e.kind,
                namespace: (_a2 = e.metadata.namespace) != null ? _a2 : "default",
                name: e.metadata.name
              };
            })
          }
        ]
      };
    }
    const gtConfig = getGiteaIntegrationConfig(this.scmIntegrationsApi, url);
    if (!gtConfig) {
      const other = this.scmIntegrationsApi.byUrl(url);
      const catalogFilename = getCatalogFilename(this.configApi);
      if (other) {
        throw new Error(
          `The ${other.title} integration only supports full URLs to ${catalogFilename} files. Did you try to pass in the URL of a directory instead?`
        );
      }
      throw new Error(
        `This URL was not recognized as a valid Gitea URL because there was no configured integration that matched the given host name. You could try to paste the full URL to a ${catalogFilename} file instead.`
      );
    }
    const ghConfig = getGithubIntegrationConfig(this.scmIntegrationsApi, url);
    if (!ghConfig) {
      const other = this.scmIntegrationsApi.byUrl(url);
      const catalogFilename = getCatalogFilename(this.configApi);
      if (other) {
        throw new Error(
          `The ${other.title} integration only supports full URLs to ${catalogFilename} files. Did you try to pass in the URL of a directory instead?`
        );
      }
      throw new Error(
        `This URL was not recognized as a valid GitHub URL because there was no configured integration that matched the given host name. You could try to paste the full URL to a ${catalogFilename} file instead.`
      );
    }
    const analyzation = await this.analyzeLocation({
      repo: url
    });
    if (analyzation.existingEntityFiles.length > 0) {
      const locations = analyzation.existingEntityFiles.reduce((state, curr) => {
        var _a2;
        state[curr.location.target] = {
          target: curr.location.target,
          exists: curr.isRegistered,
          entities: [
            ...curr.location.target in state ? state[curr.location.target].entities : [],
            {
              name: curr.entity.metadata.name,
              namespace: (_a2 = curr.entity.metadata.namespace) != null ? _a2 : "default",
              kind: curr.entity.kind
            }
          ]
        };
        return state;
      }, {});
      return {
        type: "locations",
        locations: Object.values(locations)
      };
    }
    return {
      type: "repository",
      //integrationType: "gitea",
      url,
      generatedEntities: analyzation.generateEntities.map((x) => x.entity)
    };
  }
  async preparePullRequest() {
    var _a;
    const appTitle = (_a = this.configApi.getOptionalString("app.title")) != null ? _a : "Backstage";
    const appBaseUrl = this.configApi.getString("app.baseUrl");
    const catalogFilename = getCatalogFilename(this.configApi);
    return {
      title: `Add ${catalogFilename} config file`,
      body: `This pull request adds a **Backstage entity metadata file** to this repository so that the component can be added to the [${appTitle} software catalog](${appBaseUrl}).

After this pull request is merged, the component will become available.

For more information, read an [overview of the Backstage software catalog](https://backstage.io/docs/features/software-catalog/).`
    };
  }
  async submitPullRequest(options) {
    const { repositoryUrl, fileContent, title, body } = options;
    const gtConfig = getGiteaIntegrationConfig(
      this.scmIntegrationsApi,
      repositoryUrl
    );
    if (gtConfig) {
      return await this.submitGiteaPrToRepo({
        ...gtConfig,
        repositoryUrl,
        fileContent,
        title,
        body
      });
    }
    throw new Error("unimplemented!");
  }
  async submitPullRequest(options) {
    const { repositoryUrl, fileContent, title, body } = options;
    const ghConfig = getGithubIntegrationConfig(
      this.scmIntegrationsApi,
      repositoryUrl
    );
    if (ghConfig) {
      return await this.submitGitHubPrToRepo({
        ...ghConfig,
        repositoryUrl,
        fileContent,
        title,
        body
      });
    }
    throw new Error("unimplemented!");
  }
  // TODO: this could be part of the catalog api
  async analyzeLocation(options) {
    const { token } = await this.identityApi.getCredentials();
    const response = await fetch(
      `${await this.discoveryApi.getBaseUrl("catalog")}/analyze-location`,
      {
        headers: {
          "Content-Type": "application/json",
          ...token && { Authorization: `Bearer ${token}` }
        },
        method: "POST",
        body: JSON.stringify({
          location: { type: "url", target: options.repo },
          ...this.configApi.getOptionalString(
            "catalog.import.entityFilename"
          ) && {
            catalogFilename: this.configApi.getOptionalString(
              "catalog.import.entityFilename"
            )
          }
        })
      }
    ).catch((e) => {
      throw new Error(`Failed to generate entity definitions, ${e.message}`);
    });
    if (!response.ok) {
      throw new Error(
        `Failed to generate entity definitions. Received http response ${response.status}: ${response.statusText}`
      );
    }
    const payload = await response.json();
    return payload;
  }
  // TODO: extract this function and implement for non-github
  async submitGitHubPrToRepo(options) {
    const {
      owner,
      repo,
      title,
      body,
      fileContent,
      repositoryUrl,
      githubIntegrationConfig
    } = options;
    const { token } = await this.scmAuthApi.getCredentials({
      url: repositoryUrl,
      additionalScope: {
        repoWrite: true
      }
    });
    const octo = new Octokit({
      auth: token,
      baseUrl: githubIntegrationConfig.apiBaseUrl
    });
    const branchName = getBranchName(this.configApi);
    const fileName = getCatalogFilename(this.configApi);
    const repoData = await octo.repos.get({
      owner,
      repo
    }).catch((e) => {
      throw new Error(formatHttpErrorMessage("Couldn't fetch repo data", e));
    });
    const parentRef = await octo.git.getRef({
      owner,
      repo,
      ref: `heads/${repoData.data.default_branch}`
    }).catch((e) => {
      throw new Error(
        formatHttpErrorMessage("Couldn't fetch default branch data", e)
      );
    });
    await octo.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: parentRef.data.object.sha
    }).catch((e) => {
      throw new Error(
        formatHttpErrorMessage(
          `Couldn't create a new branch with name '${branchName}'`,
          e
        )
      );
    });
    await octo.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: fileName,
      message: title,
      content: Base64.encode(fileContent),
      branch: branchName
    }).catch((e) => {
      throw new Error(
        formatHttpErrorMessage(
          `Couldn't create a commit with ${fileName} file added`,
          e
        )
      );
    });
    const pullRequestResponse = await octo.pulls.create({
      owner,
      repo,
      title,
      head: branchName,
      body,
      base: repoData.data.default_branch
    }).catch((e) => {
      throw new Error(
        formatHttpErrorMessage(
          `Couldn't create a pull request for ${branchName} branch`,
          e
        )
      );
    });
    return {
      link: pullRequestResponse.data.html_url,
      location: `https://${githubIntegrationConfig.host}/${owner}/${repo}/blob/${repoData.data.default_branch}/${fileName}`
    };
  }
  // TODO: extract this function and implement for non-gitea
  async submitGiteaPrToRepo(options) {
    const {
      owner,
      repo,
      title,
      body,
      fileContent,
      repositoryUrl,
      giteaIntegrationConfig
    } = options;
    const { token } = await this.scmAuthApi.getCredentials({
      url: repositoryUrl,
      additionalScope: {
        repoWrite: true
      }
    });
    const octo = new Octokit({
      auth: token,
      baseUrl: giteaIntegrationConfig.apiBaseUrl
    });
    const branchName = getBranchName(this.configApi);
    const fileName = getCatalogFilename(this.configApi);
    const repoData = await octo.repos.get({
      owner,
      repo
    }).catch((e) => {
      throw new Error(formatHttpErrorMessage("Couldn't fetch repo data", e));
    });
    const parentRef = await octo.git.getRef({
      owner,
      repo,
      ref: `heads/${repoData.data.default_branch}`
    }).catch((e) => {
      throw new Error(
        formatHttpErrorMessage("Couldn't fetch default branch data", e)
      );
    });
    await octo.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: parentRef.data.object.sha
    }).catch((e) => {
      throw new Error(
        formatHttpErrorMessage(
          `Couldn't create a new branch with name '${branchName}'`,
          e
        )
      );
    });
    await octo.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: fileName,
      message: title,
      content: Base64.encode(fileContent),
      branch: branchName
    }).catch((e) => {
      throw new Error(
        formatHttpErrorMessage(
          `Couldn't create a commit with ${fileName} file added`,
          e
        )
      );
    });
    const pullRequestResponse = await octo.pulls.create({
      owner,
      repo,
      title,
      head: branchName,
      body,
      base: repoData.data.default_branch
    }).catch((e) => {
      throw new Error(
        formatHttpErrorMessage(
          `Couldn't create a pull request for ${branchName} branch`,
          e
        )
      );
    });
    return {
      link: pullRequestResponse.data.html_url,
      location: `https://${giteaIntegrationConfig.host}/${owner}/${repo}/blob/${repoData.data.default_branch}/${fileName}`
    };
  }
}
function formatHttpErrorMessage(message, error) {
  return `${message}, received http response status code ${error.status}: ${error.message}`;
}

const rootRouteRef = createRouteRef({
  id: "catalog-import"
});
const catalogImportPlugin = createPlugin({
  id: "catalog-import",
  apis: [
    createApiFactory({
      api: catalogImportApiRef,
      deps: {
        discoveryApi: discoveryApiRef,
        scmAuthApi: scmAuthApiRef,
        identityApi: identityApiRef,
        scmIntegrationsApi: scmIntegrationsApiRef,
        catalogApi: catalogApiRef,
        configApi: configApiRef
      },
      factory: ({
        discoveryApi,
        scmAuthApi,
        identityApi,
        scmIntegrationsApi,
        catalogApi,
        configApi
      }) => new CatalogImportClient({
        discoveryApi,
        scmAuthApi,
        scmIntegrationsApi,
        identityApi,
        catalogApi,
        configApi
      })
    })
  ],
  routes: {
    importPage: rootRouteRef
  }
});
const CatalogImportPage = catalogImportPlugin.provide(
  createRoutableExtension({
    name: "CatalogImportPage",
    component: () => import('./index-c3f2eabe.esm.js').then((m) => m.ImportPage),
    mountPoint: rootRouteRef
  })
);

export { CatalogImportPage as C, catalogImportApiRef as a, CatalogImportClient as b, catalogImportPlugin as c, asInputRef as d, getCatalogFilename as g, rootRouteRef as r };
//# sourceMappingURL=plugin-014562a4.esm.js.map
